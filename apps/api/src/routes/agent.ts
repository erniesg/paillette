/**
 * POST /api/public-agent/turn — one turn of an agent loop, for visitors who
 * did not arrive with an agent of their own.
 *
 * WebMCP's premise is that *your* agent drives *this* page, and that is how
 * Paillette is meant to be used. But it leaves anyone without a WebMCP-capable
 * browser looking at a search box, unable to see the thing the tools exist for.
 * This route closes that gap: the page sends the tool schemas it registered on
 * `document.modelContext` plus the conversation so far, and gets back the
 * model's next move.
 *
 * Deliberately stateless and deliberately does not execute anything. Tool calls
 * come back to the browser, which runs them through the same
 * `document.modelContext` an external agent would use, and posts the results
 * into the next turn. The page stays the only thing that touches the page.
 *
 * Bounded like the other anonymous paid routes: the shared daily OpenAI budget
 * via `openaiCompletion`, a per-caller hourly cap, a turn cap enforced by the
 * caller's own message count, and a hard ceiling on payload size.
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import { openaiChat, type OpenAiToolMessage } from '../utils/openai';

/**
 * One conversation should not be able to spend the whole daily budget.
 *
 * This counts **model calls, not turns**, and the difference is large enough to
 * plan around: one thing a person types costs two or three requests, because
 * the loop reads the view, acts on it, and then answers. Forty calls is
 * therefore something like fifteen typed instructions in an hour, not forty.
 *
 * The old name said "turns" and made the budget read as nearly three times what
 * it is — which matters when someone rehearses a demo and finds the agent dead
 * on the take. The deterministic loop is unaffected by this ceiling: Enter on
 * an empty bar never reaches this route.
 */
export const MAX_AGENT_MODEL_CALLS_PER_CLIENT_PER_HOUR = 40;
/** Beyond this the loop is not converging and should be stopped. */
export const MAX_MESSAGES_PER_REQUEST = 60;
const MAX_BODY_CHARS = 120_000;
const AGENT_MODEL = 'gpt-5.6-terra';

/**
 * The behaviour that makes this feel like an agent rather than a search box
 * belongs here, in the product — not in whatever the visitor happened to type.
 * Someone who says "something warm for above the sofa" should not also have to
 * say "try several interpretations and merge them"; working that out is the job.
 *
 * The gesture rules below are the part that could not exist anywhere else. A
 * search box has words and no gestures; a chat has words and no board. This
 * page has both, so it is the only place where a model can be told what to do
 * when the two disagree — and the answer is not "ask", it is "follow the hands
 * and say so out loud".
 */
const SYSTEM_PROMPT = [
  'You operate a museum art-search page through the tools it exposes.',
  'Work on the page, not in text: put what you find on the screen with set_results, and open a single work with show_artwork.',
  'Most requests are goals, not queries — "something warm for above the sofa", "a room about storms at sea". Treat a goal as your problem to interpret.',
  'For a goal: decide three or four genuinely different things it could mean, search for each one separately, and use search_by_color or search_by_image where the goal is about how something looks rather than what it depicts.',
  'Then assemble one board with set_results, taking the best of every angle you tried rather than the top of any single search, and pass a note.',
  'The note is a wall label, not a paragraph: one sentence, under about twenty-five words, naming the through-line. Museums are terse on purpose and the pictures are doing the talking. No preamble and no describing what you just did.',
  'Choose the layout with set_view when it helps: atlas when you want to show how a cross-section relates, salon for a curated hang, table for comparing catalogue fields.',
  'A plain, specific query — an artist, a medium, a date — needs none of that. Run it and show the results.',

  // --- The gestures ------------------------------------------------------
  'You share this page with the person using it, and they act on it as much as you do. They flag works as picks and rejects with P and X, they select and hover, and they choose between two works you put side by side. Every turn you receive carries what they did as well as what they said, and get_view_context reports the flags, the board and what they are pointing at.',
  'When the human\'s words and their gestures conflict, follow the gestures and say so. Name the gap in one plain sentence and act on the picks: "You said warm; you\'ve picked three cool ones. I\'m following the picks." Do not ask them which they meant, do not quietly average the two, and do not pretend you did not notice. The gap is usually the most useful thing on the screen — it is where they are discovering what they actually want.',
  'A pick is a constraint to build around, not just a work to keep. Whatever else changes, those stay, so your job is to find what goes with them.',
  'A reject tells you about the axis they care about, not merely that one work is out. Ask yourself what that work had that the picks do not, and move the whole board away from it — one strong rejection is worth more than three vague picks.',
  'Their reasons are not always in words. When picks share something they have not named, name it for them in your note — "these are all horizon-line pictures" — and let them correct you. Being usefully wrong about it is better than being silent.',

  // --- The loop ----------------------------------------------------------
  'The board holds twelve works. Use redeal to deal a new one from the flags: picks hold their positions, rejects leave, newcomers fill the gaps. This is the same operation the human runs by pressing Enter on an empty prompt bar, so do not describe it as something you are doing for them.',
  'Once anything is flagged, redeal is the tool, not set_results. Their flags are a direction through the collection and redeal is the only thing that follows it — set_results is for putting a fresh set on screen when there is nothing to follow yet. Searching by hand and pinning your favourites throws their judgement away and starts again from yours.',
  'If anything is flagged, redeal before you reply. A turn that produces only words has left the board exactly as it was and told them nothing they could not already see.',
  'On a redeal after they have flagged something, the note is where the disagreement gets named, in that one sentence: "You said warm; you picked the grey harbour and rejected the golds — following the picks." Name what they threw out, not only what you kept.',
  'Use flag_artworks to disagree in their own currency, at most three at a time and always with a reason. Your flags arrive provisional and do not steer the redeal until they confirm them; that is deliberate, so propose freely.',
  'Use compare_artworks when you have a real hypothesis about what they want and two works that differ on exactly that axis. One click from them is worth more than a paragraph of questions, and it is the only question you may ask.',
  'They can also refuse the pair outright, with or without saying why. Read that as the most useful answer you have had: your hypothesis about the axis was wrong, both works are now rejected, and the next move is a different question rather than the same one with new pictures.',

  // --- The exhibition ----------------------------------------------------
  'Once a board has settled into something, it is an exhibition and not a search result. Draft it: set_exhibition with a title and a statement, then write_labels for the works on the board. Do this without being asked — a board with no title is a pile.',
  'The statement is 60 to 100 words on what the show is about. Not what you did, not how you found them: what the room is about. The title is a few words, the way a museum names a room.',
  'A wall label is one or two sentences about that work in this show. The same painting in a show about weather and a show about grief does not get the same label; if your labels would read the same under any other statement, they are captions and you have not done the work. write_labels writes them all against the statement, so write the statement first.',
  'The human edits the title, the statement and any label directly on the page, and anything they have touched is theirs. get_view_context and get_exhibition mark those fields. You may propose an alternative — a set_exhibition write onto a held field is parked as a proposal they can accept with one click — but you may not restate their sentence in your own words and call it a draft.',
  'When they rewrite the statement, that is the most important thing that has happened. Take their words as the brief and act, in this order: first write_labels for the works already on the board, because the same works read differently under a new statement and that is the change they will see; then drop whatever no longer belongs with removeArtworkIds; then, only if the show is still short, search for works that fit what they actually said. Do the labels first and the searching last — a run that spends itself hunting and never relabels leaves the statement changed and the wall unchanged, which is the same as having done nothing.',
  'Never argue with a correction and never explain that you had understood it differently. They know. Change the show.',

  'Be decisive and never ask clarifying questions.',
  'Never repeat your note as your reply. The note is already on the wall above the board; saying the same sentence twice on one screen is the thing people hate about talkative software. Either add one sentence the note does not say, or say nothing at all — the board is the rest of the answer.',
].join(' ');

const jsonError = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

/**
 * The gesture half of a human turn, as the page sends it.
 *
 * A click is a turn even with no text, so `text` is optional and everything
 * else describes what their hands did since the last turn. Titles arrive
 * resolved because the catalogue lives in the browser's session index, not
 * here — this route stays stateless and never looks anything up.
 */
export interface HumanTurnPayload {
  text?: string;
  flagsDelta?: {
    artworkId: string;
    title?: string;
    to: 'pick' | 'reject' | null;
  }[];
  selection?: { id: string; title?: string }[];
  hovered?: { id: string; title?: string } | null;
  compareChoice?:
    | {
        winner: { id: string; title?: string };
        loser: { id: string; title?: string };
        question?: string | null;
      }
    | {
        /** They refused both. The strongest answer a two-up can get. */
        neither: { id: string; title?: string }[];
        reason?: string | null;
        question?: string | null;
      }
    | null;
  /** What the human rewrote in the exhibition since the last turn. */
  exhibitionEdits?: {
    field: 'title' | 'statement' | 'label';
    work?: string;
    value: string;
  }[];
}

const named = (entry: { id?: string; artworkId?: string; title?: string }) =>
  entry.title?.trim() || entry.artworkId || entry.id || 'an untitled work';

/**
 * Render the gestures as a sentence rather than as JSON.
 *
 * The rule this feeds — gestures outrank words — is a judgement, and models
 * follow judgements stated in prose far more reliably than ones they have to
 * infer from a data structure they were handed. So the payload becomes
 * English, and it is labelled as observed fact so it cannot be mistaken for
 * something the human typed.
 */
export const describeHumanTurn = (turn: HumanTurnPayload): string | null => {
  const parts: string[] = [];
  const delta = turn.flagsDelta ?? [];

  const picked = delta.filter((change) => change.to === 'pick');
  const rejected = delta.filter((change) => change.to === 'reject');
  const cleared = delta.filter((change) => change.to === null);

  if (picked.length) parts.push(`picked ${picked.map(named).join('; ')}`);
  if (rejected.length) parts.push(`rejected ${rejected.map(named).join('; ')}`);
  if (cleared.length) parts.push(`unflagged ${cleared.map(named).join('; ')}`);
  if (turn.compareChoice) {
    const asked = turn.compareChoice.question
      ? ` when asked "${turn.compareChoice.question}"`
      : '';
    if ('neither' in turn.compareChoice) {
      // A refusal is worth more than either choice would have been: it names
      // the axis rather than picking a point on it. Both works are already
      // rejected, so say what it means rather than what was clicked.
      parts.push(
        `refused both ${turn.compareChoice.neither.map(named).join(' and ')}${asked}` +
          (turn.compareChoice.reason
            ? `, saying "${turn.compareChoice.reason}"`
            : '') +
          ' — that is a stronger signal than either choice, and both are now rejected'
      );
    } else {
      parts.push(
        `chose ${named(turn.compareChoice.winner)} over ${named(turn.compareChoice.loser)}${asked}`
      );
    }
  }
  if (turn.selection?.length) {
    parts.push(`selected ${turn.selection.map(named).join('; ')}`);
  }
  if (turn.hovered) parts.push(`is pointing at ${named(turn.hovered)}`);

  // The corrections, kept separate and put last.
  //
  // A rewritten statement is not one gesture among several — it is the human
  // telling you what the show is actually about, and it outranks the
  // instruction they typed three turns ago. Folding it into the same sentence
  // as "is pointing at" would bury the loudest thing on the page.
  const edits = (turn.exhibitionEdits ?? []).filter((edit) => edit.value);
  const corrections = edits.map((edit) =>
    edit.field === 'label'
      ? `the label on ${edit.work || 'a work'} now reads: "${edit.value}"`
      : `the exhibition ${edit.field} now reads: "${edit.value}"`
  );

  if (!parts.length && !corrections.length) return null;

  return [
    parts.length
      ? `Since the last turn the human ${parts.join(', and ')}.`
      : null,
    parts.length
      ? 'These are gestures, not words. If they contradict what was typed, follow the gestures and say plainly that you are doing so.'
      : null,
    corrections.length
      ? `The human has rewritten the show in their own words: ${corrections.join('; ')}.`
      : null,
    corrections.length
      ? 'Those are their words and they are now the brief. Do not restate them, do not paraphrase them back, and do not write over them. Your first tool call now is write_labels over the works already hanging, because every label on the wall was written against the old theme and is now wrong. Do that before you search, redeal or set_results — a reply that re-selects works but leaves the old labels in place has changed the statement and not the wall, which is the same as having done nothing.'
      : null,
  ]
    .filter(Boolean)
    .join(' ');
};

const toHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

const getClientHash = async (connectingIp: string | undefined) => {
  const candidate = connectingIp?.trim();
  if (!candidate || candidate.length > 45) return null;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`webmcp-agent:${candidate}`)
  );
  return toHex(digest);
};

const withinAgentRateLimit = async (
  env: Env,
  clientHash: string | null
): Promise<boolean> => {
  if (!clientHash || !env.CACHE) return true;
  const bucket = Math.floor(Date.now() / 3_600_000);
  const key = `webmcp-agent:v1:${bucket}:${clientHash}`;
  try {
    const used = Number((await env.CACHE.get(key)) || '0');
    if (Number.isFinite(used) && used >= MAX_AGENT_MODEL_CALLS_PER_CLIENT_PER_HOUR) {
      return false;
    }
    await env.CACHE.put(key, String((Number.isFinite(used) ? used : 0) + 1), {
      expirationTtl: 7200,
    });
    return true;
  } catch {
    return true;
  }
};

const agent = new Hono<{ Bindings: Env }>();

agent.post('/public-agent/turn', async (c) => {
  const raw = await c.req.text();
  if (raw.length > MAX_BODY_CHARS) {
    return c.json(
      jsonError('PAYLOAD_TOO_LARGE', 'That conversation is too long to continue.'),
      413
    );
  }

  let body: { messages?: unknown; tools?: unknown; turn?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return c.json(jsonError('INVALID_INPUT', 'Invalid JSON request body.'), 400);
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  if (messages.length === 0) {
    return c.json(jsonError('INVALID_INPUT', 'messages is required.'), 400);
  }
  if (messages.length > MAX_MESSAGES_PER_REQUEST) {
    return c.json(
      jsonError(
        'TOO_MANY_TURNS',
        'This conversation ran too long without settling. Start a new one.'
      ),
      400
    );
  }
  if (tools.length === 0) {
    return c.json(
      jsonError(
        'NO_TOOLS',
        'No tools were offered. The page registers these on document.modelContext.'
      ),
      400
    );
  }

  // A turn is optional: an agent driving this route from outside the page has
  // no gestures to report, and the loop must still work for it.
  const gestures =
    body.turn && typeof body.turn === 'object'
      ? describeHumanTurn(body.turn as HumanTurnPayload)
      : null;

  const clientHash = await getClientHash(
    c.req.header('CF-Connecting-IP') || undefined
  );
  if (!(await withinAgentRateLimit(c.env, clientHash))) {
    return c.json(
      jsonError(
        'AGENT_RATE_LIMITED',
        'You have used this hour’s shared agent budget. Try again shortly.'
      ),
      429
    );
  }

  try {
    const message = await openaiChat({
      env: c.env,
      model: AGENT_MODEL,
      // The GPT-5.x family spends its completion budget on reasoning first, so
      // an agent turn needs room for both that and the tool call it emits.
      maxTokens: 1200,
      reasoningEffort: 'none',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...(messages as OpenAiToolMessage[]),
        // Placed after the conversation, not before it: what the human just
        // did with their hands is the most recent thing that happened, and it
        // should read that way rather than as standing background.
        ...(gestures
          ? [{ role: 'system' as const, content: gestures }]
          : []),
      ],
      tools: tools as Record<string, unknown>[],
      signal: c.req.raw.signal,
    });

    return c.json(
      { success: true as const, data: { message } },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const status =
      error && typeof error === 'object' && 'status' in error
        ? Number((error as { status?: unknown }).status) || 503
        : 503;
    return c.json(
      jsonError(
        'AGENT_UNAVAILABLE',
        status === 429
          ? 'The shared daily agent budget for this site is spent.'
          : 'The agent is temporarily unavailable.'
      ),
      status === 429 ? 429 : 503
    );
  }
});

export default agent;
