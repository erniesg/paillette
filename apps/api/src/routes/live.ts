/**
 * The four requests a live session makes, all of them metered.
 *
 * A realtime session is not a route the way `/public-agent/turn` is — the
 * conversation happens over WebRTC directly between the browser and OpenAI,
 * and nothing about it passes through here once it is running. That is exactly
 * the problem this file solves: something has to be the place where the cost
 * is decided, and the only moments the Worker is in the loop are the ones
 * below.
 *
 *   POST /api/public-live/token      mint, and debit the grant
 *   POST /api/public-live/call       proxy the SDP offer, learn the call id
 *   POST /api/public-live/heartbeat  enforce the grant while the call runs
 *   POST /api/public-live/close      settle, refunding what was not used
 *
 * Anonymous, like the rest of this surface, and metered because of it. The
 * account key never leaves the Worker; the page holds a sixty-second
 * ephemeral credential and an opaque session id, neither of which can outlive
 * the grant they were issued against.
 *
 * **The ceiling does not depend on the page behaving.** The grant is debited
 * in full at mint. Heartbeat and close can only ever give seconds back. A tab
 * that vanishes mid-sentence has spent its whole grant and left the meter
 * correct; the sweep hangs its call up at the provider the next time anybody
 * asks for a session.
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import { SYSTEM_PROMPT } from './agent';
import { getClientHash } from '../utils/client-hash';
import {
  readLiveAudioBudget,
  reserveLiveAudio,
  sessionMaxSeconds,
  settleLiveAudio,
} from '../utils/live-audio-budget';
import {
  DEFAULT_LIVE_MODEL,
  createRealtimeCall,
  hangupRealtimeCall,
  mintClientSecret,
  RealtimeUnavailableError,
} from '../utils/openai-realtime';

/** Marin reads as a gallery voice rather than an assistant one. */
const LIVE_VOICE = 'marin';

/**
 * The same agent, out loud.
 *
 * Built on `/public-agent/turn`'s prompt rather than beside it, because two
 * prompts for one agent is how the spoken half and the typed half start
 * disagreeing about what a pick means — and the whole argument of this feature
 * is that there is one conversation, not two.
 *
 * What is added is only what changes when the reply is audible. A wall label
 * read aloud is still one sentence; a wall label read aloud that runs to a
 * paragraph is the software talking over the room.
 */
const LIVE_ADDENDUM = [
  'This conversation is live: the person can speak to you or type to you, in either order, and you can answer in speech or in text. It is one conversation and they are not choosing a mode — do not mention which one they used, and never ask them to switch.',
  'Everything you say aloud is one sentence. Not two short ones, not a sentence with a clause of explanation bolted on. The board is the rest of the answer and it is already in front of them; say the one thing the board cannot say for itself, and stop.',
  'Do the work before you speak. Call the tools first and answer once the board has moved — a spoken sentence describing what you are about to do is the mechanism narrating itself, out loud, which is worse than in text.',
  'Never read out a list. If the answer is six paintings, the answer is six paintings on the screen and a sentence about what they have in common.',
  'Speech misspells names and always will. When you are unsure of an artist or a title, search for what you heard rather than asking them to repeat it; a wrong search they can see is faster to fix than a question they have to answer.',
].join(' ');

const liveInstructions = () => `${SYSTEM_PROMPT} ${LIVE_ADDENDUM}`;

/** An SDP offer for one audio track is a couple of kilobytes. */
const MAX_SDP_CHARS = 32_000;

/**
 * Sessions older than this are swept even if their grant says otherwise —
 * a floor under any arithmetic mistake, and well inside OpenAI's own
 * sixty-minute ceiling on a realtime call.
 */
const ABSOLUTE_SESSION_CEILING_SECONDS = 15 * 60;

const jsonError = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

const nowSeconds = () => Math.floor(Date.now() / 1000);

const liveModel = (env: Env): string =>
  env.LIVE_SESSION_MODEL?.trim() || DEFAULT_LIVE_MODEL;

type SessionRow = {
  id: string;
  client_hash: string;
  caller_scope: string;
  site_scope: string;
  granted_seconds: number;
  call_id: string | null;
  started_at: number;
  expires_at: number;
  closed_at: number | null;
};

const loadSession = async (
  env: Env,
  id: string,
  clientHash: string
): Promise<SessionRow | null> => {
  if (!env.DB || !id) return null;
  const row = await env.DB.prepare(
    `SELECT id, client_hash, caller_scope, site_scope, granted_seconds,
            call_id, started_at, expires_at, closed_at
     FROM live_audio_sessions WHERE id = ?`
  )
    .bind(id)
    .first<SessionRow>();
  // The id is 128 bits of randomness, so this check is not what keeps sessions
  // apart. It is what stops one visitor's meter being settled by another's
  // request if an id ever does leak — through a shared screen, say.
  if (!row || row.client_hash !== clientHash) return null;
  return row;
};

/**
 * Close a session: settle the meter and hang the call up at the provider.
 *
 * Idempotent on `closed_at`, because all three of close, heartbeat-expiry and
 * the sweep can reach the same row, and settling twice would refund twice.
 */
const closeSession = async (
  env: Env,
  row: SessionRow,
  reason: string,
  at: number = nowSeconds()
): Promise<void> => {
  if (!env.DB || row.closed_at !== null) return;

  const claimed = await env.DB.prepare(
    `UPDATE live_audio_sessions
     SET closed_at = ?2, spent_seconds = ?3, close_reason = ?4
     WHERE id = ?1 AND closed_at IS NULL
     RETURNING id`
  )
    .bind(
      row.id,
      at,
      Math.max(0, Math.min(row.granted_seconds, at - row.started_at)),
      reason
    )
    .first<{ id: string }>();
  // Somebody else got there first. Theirs is the settlement that counts.
  if (!claimed) return;

  await settleLiveAudio(
    env,
    {
      callerScope: row.caller_scope,
      siteScope: row.site_scope,
      grantedSeconds: row.granted_seconds,
    },
    at - row.started_at
  );

  if (row.call_id) await hangupRealtimeCall(env, row.call_id);
};

/**
 * Hang up every session that has outlived its grant.
 *
 * Run on mint and on heartbeat rather than on a schedule, because a Worker has
 * no timer of its own. The consequence is worth stating plainly: a stale
 * session is cut when the *next* person asks for one, not the instant it
 * expires. Its cost is already accounted for either way — the grant was
 * debited up front — so the sweep is about not paying for silence, not about
 * the ceiling holding.
 */
const sweepExpiredSessions = async (env: Env): Promise<number> => {
  if (!env.DB) return 0;
  const cutoff = nowSeconds();
  const { results } = await env.DB.prepare(
    `SELECT id, client_hash, caller_scope, site_scope, granted_seconds,
            call_id, started_at, expires_at, closed_at
     FROM live_audio_sessions
     WHERE closed_at IS NULL AND (expires_at <= ?1 OR started_at <= ?2)
     LIMIT 25`
  )
    .bind(cutoff, cutoff - ABSOLUTE_SESSION_CEILING_SECONDS)
    .all<SessionRow>();

  for (const row of results ?? []) {
    await closeSession(env, row, 'expired', Math.min(cutoff, row.expires_at));
  }
  return results?.length ?? 0;
};

const live = new Hono<{ Bindings: Env }>();

/**
 * Mint a session, or refuse in a sentence the page can show.
 *
 * This is the gate. Every other route here can only spend a grant this one
 * already approved, so there is exactly one place to read to know what a
 * visitor can cost.
 */
live.post('/public-live/token', async (c) => {
  const clientHash = await getClientHash(
    c.req.header('CF-Connecting-IP') || undefined,
    'webmcp-live'
  );
  // A request counter can shrug at an unidentifiable caller and let it through;
  // a spend counter cannot. Without an identity there is no per-caller ceiling,
  // and "no ceiling" is the state this route exists to make impossible.
  if (!clientHash) {
    return c.json(
      jsonError(
        'LIVE_UNIDENTIFIED',
        'Live audio needs a connecting address to meter against.'
      ),
      403
    );
  }
  if (!c.env.DB) {
    return c.json(
      jsonError('LIVE_UNAVAILABLE', 'Live audio is unavailable.'),
      503
    );
  }

  // Best-effort, and deliberately before the reservation: a session that
  // expired ten minutes ago is still holding seconds that this caller could
  // be given back.
  try {
    await sweepExpiredSessions(c.env);
  } catch {
    // A failed sweep must not refuse a caller who is within budget.
  }

  const grant = await reserveLiveAudio(c.env, clientHash);
  if (!grant.admitted) {
    if (grant.reason === 'unavailable') {
      return c.json(
        jsonError('LIVE_UNAVAILABLE', 'Live audio is unavailable.'),
        503
      );
    }
    // Two different refusals, said apart. One resets on the hour for this
    // visitor; the other is everybody's and resets at midnight UTC. The page
    // paints the sentence as-is, so it has to be true rather than generic —
    // and short, because it is a wall label and not an explanation. Neither
    // tells anyone to type instead: the bar is on screen with a caret in it.
    return c.json(
      grant.reason === 'site'
        ? jsonError('LIVE_BUDGET_SPENT', 'No live audio left today.')
        : jsonError('LIVE_BUDGET_SPENT', 'No live audio left this hour.'),
      429
    );
  }

  const model = liveModel(c.env);
  let secret;
  try {
    secret = await mintClientSecret(c.env, {
      model,
      voice: LIVE_VOICE,
      instructions: liveInstructions(),
      signal: c.req.raw.signal,
    });
  } catch (error) {
    // Nothing was spent, so nothing should stay debited.
    await settleLiveAudio(
      c.env,
      {
        callerScope: grant.callerScope,
        siteScope: grant.siteScope,
        grantedSeconds: grant.seconds,
      },
      0
    );
    const failure =
      error instanceof RealtimeUnavailableError
        ? error
        : new RealtimeUnavailableError('Live audio is unavailable.');
    return c.json(
      jsonError(failure.code, 'Live audio is unavailable.'),
      failure.status === 429 ? 429 : 503
    );
  }

  const id = crypto.randomUUID().replace(/-/g, '');
  const startedAt = nowSeconds();
  await c.env.DB.prepare(
    `INSERT INTO live_audio_sessions
       (id, client_hash, caller_scope, site_scope, granted_seconds,
        started_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  )
    .bind(
      id,
      clientHash,
      grant.callerScope,
      grant.siteScope,
      grant.seconds,
      startedAt,
      startedAt + grant.seconds
    )
    .run();

  return c.json(
    {
      success: true as const,
      data: {
        sessionId: id,
        token: secret.value,
        tokenExpiresAt: secret.expiresAt,
        model,
        /** Wall-clock the page may stay connected for. It is not advisory. */
        grantedSeconds: grant.seconds,
        maxSessionSeconds: sessionMaxSeconds(c.env),
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});

/**
 * Exchange the browser's SDP offer for the provider's answer.
 *
 * The one reason this is not a direct browser-to-OpenAI request: the answer's
 * `Location` header carries the call id, and the call id is the only handle
 * that can stop a running session from this side. Letting the page connect
 * directly would mean asking it to report its own id, which is the same as
 * having no stop at all.
 */
live.post('/public-live/call', async (c) => {
  const clientHash = await getClientHash(
    c.req.header('CF-Connecting-IP') || undefined,
    'webmcp-live'
  );
  if (!clientHash || !c.env.DB) {
    return c.json(jsonError('LIVE_UNAVAILABLE', 'Live audio is unavailable.'), 503);
  }

  const sessionId = c.req.query('session') ?? '';
  const offer = await c.req.text();
  if (!offer || offer.length > MAX_SDP_CHARS) {
    return c.json(jsonError('INVALID_INPUT', 'That is not an SDP offer.'), 400);
  }

  const row = await loadSession(c.env, sessionId, clientHash);
  if (!row || row.closed_at !== null) {
    return c.json(
      jsonError('LIVE_SESSION_UNKNOWN', 'That live session is no longer open.'),
      404
    );
  }
  if (row.call_id) {
    return c.json(
      jsonError('LIVE_SESSION_USED', 'That live session has already connected.'),
      409
    );
  }

  const token = c.req.header('X-Live-Token') ?? '';
  if (!token) {
    return c.json(jsonError('INVALID_INPUT', 'Missing session credential.'), 400);
  }

  let call;
  try {
    call = await createRealtimeCall(token, offer, {
      model: liveModel(c.env),
      signal: c.req.raw.signal,
    });
  } catch (error) {
    const failure =
      error instanceof RealtimeUnavailableError
        ? error
        : new RealtimeUnavailableError('Live audio is unavailable.');
    // The connection never happened; give the grant back rather than charging
    // for a session that produced no audio.
    await closeSession(c.env, row, 'connect-failed', row.started_at);
    return c.json(
      jsonError(failure.code, 'Live audio is unavailable.'),
      failure.status === 429 ? 429 : 503
    );
  }

  // Restart the clock here rather than at mint: the grant is seconds of
  // *session*, and the time spent asking for a microphone is not session time.
  const connectedAt = nowSeconds();
  await c.env.DB.prepare(
    `UPDATE live_audio_sessions
     SET call_id = ?2, started_at = ?3, expires_at = ?4
     WHERE id = ?1 AND closed_at IS NULL`
  )
    .bind(row.id, call.callId, connectedAt, connectedAt + row.granted_seconds)
    .run();

  return c.body(call.answerSdp, 200, {
    'Content-Type': 'application/sdp',
    'Cache-Control': 'no-store',
  });
});

/**
 * Is this session still inside its grant?
 *
 * The page asks every few seconds. A `false` answer arrives after the call has
 * already been hung up at the provider, so it is a notification rather than an
 * instruction — the page cannot decline to stop, it can only decline to say so.
 */
live.post('/public-live/heartbeat', async (c) => {
  const clientHash = await getClientHash(
    c.req.header('CF-Connecting-IP') || undefined,
    'webmcp-live'
  );
  if (!clientHash || !c.env.DB) {
    return c.json(jsonError('LIVE_UNAVAILABLE', 'Live audio is unavailable.'), 503);
  }

  const { sessionId } = (await c.req
    .json()
    .catch(() => ({}))) as { sessionId?: string };
  const row = await loadSession(c.env, sessionId ?? '', clientHash);
  if (!row) {
    return c.json(
      jsonError('LIVE_SESSION_UNKNOWN', 'That live session is no longer open.'),
      404
    );
  }

  try {
    await sweepExpiredSessions(c.env);
  } catch {
    // The check below is what matters for this caller; the sweep is for others.
  }

  const at = nowSeconds();
  if (row.closed_at !== null || at >= row.expires_at) {
    await closeSession(c.env, row, 'budget-exhausted', Math.min(at, row.expires_at));
    return c.json(
      {
        success: true as const,
        data: {
          open: false,
          remainingSeconds: 0,
          reason: 'Live audio time is up.',
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return c.json(
    {
      success: true as const,
      data: { open: true, remainingSeconds: row.expires_at - at, reason: null },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});

/** The page hanging up. Settles the meter and refunds the unused remainder. */
live.post('/public-live/close', async (c) => {
  const clientHash = await getClientHash(
    c.req.header('CF-Connecting-IP') || undefined,
    'webmcp-live'
  );
  if (!clientHash || !c.env.DB) {
    return c.json({ success: true as const, data: { closed: false } });
  }

  const { sessionId } = (await c.req
    .json()
    .catch(() => ({}))) as { sessionId?: string };
  const row = await loadSession(c.env, sessionId ?? '', clientHash);
  if (row) await closeSession(c.env, row, 'client-closed');

  const budget = await readLiveAudioBudget(c.env, clientHash);
  return c.json(
    {
      success: true as const,
      data: {
        closed: true,
        callerRemainingSeconds: budget?.callerRemaining ?? null,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});

export default live;
