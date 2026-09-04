/**
 * The three OpenAI Realtime calls this repo makes, and nothing else.
 *
 * Facts below were read from OpenAI's own documentation on **2026-09-04**;
 * they move, and the report records the date for that reason.
 *
 *  - `POST /v1/realtime/client_secrets` mints an ephemeral credential
 *    (`ek_...`) for a browser. `expires_after.anchor` accepts only
 *    `created_at`; `expires_after.seconds` is 10–7200 and defaults to 600.
 *  - `POST /v1/realtime/calls` takes an SDP offer as `application/sdp` and
 *    answers with SDP. The response's `Location` header carries the call id
 *    (`/v1/realtime/calls/rtc_...`).
 *  - `POST /v1/realtime/calls/{call_id}/hangup` ends an active call, "whether
 *    it was initiated over SIP or WebRTC".
 *
 * The last two are why the offer is proxied through the Worker rather than
 * posted straight to OpenAI from the page. The ephemeral token's expiry gates
 * *starting* a session and does nothing to one already running — OpenAI's own
 * docs are explicit about that — so the only server-side stop that exists is
 * hangup, and hangup needs a call id. Proxying the offer is how the Worker
 * learns it without asking the client to volunteer it.
 */

const REALTIME_ROOT = 'https://api.openai.com/v1/realtime';

/**
 * `gpt-realtime-2.1` — the current flagship realtime model as of 2026-09-04,
 * at $32/1M audio input tokens, $0.40/1M cached audio input, $64/1M audio
 * output, $4/1M text input and $24/1M text output.
 *
 * The mini variant (`gpt-realtime-2.1-mini`, $10/$20 audio) is a third of the
 * price and is the obvious lever if the budget below turns out to bind. It is
 * not the default because this session drives twenty-five tools against a
 * catalogue and tool-call accuracy is the thing that shows on camera.
 */
export const DEFAULT_LIVE_MODEL = 'gpt-realtime-2.1';

/**
 * The token has to survive a page's `getUserMedia` prompt and an ICE
 * negotiation, and nothing else. Sixty seconds is generous for that and short
 * enough that a token scraped from a network log is worthless by the time
 * anyone reads it.
 */
export const CLIENT_SECRET_TTL_SECONDS = 60;

export type RealtimeEnv = { OPENAI_API_KEY?: string };

export class RealtimeUnavailableError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status = 503, code = 'LIVE_UNAVAILABLE') {
    super(message);
    this.name = 'RealtimeUnavailableError';
    this.status = status;
    this.code = code;
  }
}

const requireKey = (env: RealtimeEnv): string => {
  const key = env.OPENAI_API_KEY;
  if (!key) {
    throw new RealtimeUnavailableError(
      'OPENAI_API_KEY is not configured',
      503,
      'LIVE_NOT_CONFIGURED'
    );
  }
  return key;
};

export type ClientSecret = { value: string; expiresAt: number };

/**
 * Mint an ephemeral client credential.
 *
 * The model, the voice and the instructions are pinned here, server-side, and
 * travel bound to the token. The tools are not: they live on
 * `document.modelContext` and are only knowable once the page has registered
 * them, so the page adds those over the data channel after connecting.
 *
 * The split is not arbitrary. What is pinned here is what costs money or sets
 * behaviour; what the page supplies is the list of things it is willing to let
 * the session do to itself.
 */
export const mintClientSecret = async (
  env: RealtimeEnv,
  options: {
    model: string;
    voice: string;
    instructions: string;
    signal?: AbortSignal;
  }
): Promise<ClientSecret> => {
  const response = await fetch(`${REALTIME_ROOT}/client_secrets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireKey(env)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expires_after: { anchor: 'created_at', seconds: CLIENT_SECRET_TTL_SECONDS },
      session: {
        type: 'realtime',
        model: options.model,
        instructions: options.instructions,
        audio: { output: { voice: options.voice } },
      },
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    // The provider's body can quote the key back in an auth error. Only the
    // status crosses this boundary.
    throw new RealtimeUnavailableError(
      `Realtime client secret request failed with ${response.status}`,
      response.status === 429 ? 429 : 503,
      response.status === 429 ? 'LIVE_RATE_LIMITED' : 'LIVE_UNAVAILABLE'
    );
  }

  const payload = (await response.json()) as {
    value?: unknown;
    expires_at?: unknown;
  };
  if (typeof payload.value !== 'string' || !payload.value) {
    throw new RealtimeUnavailableError(
      'Realtime client secret response had no token',
      503,
      'LIVE_UNAVAILABLE'
    );
  }
  return {
    value: payload.value,
    expiresAt:
      typeof payload.expires_at === 'number'
        ? payload.expires_at
        : Math.floor(Date.now() / 1000) + CLIENT_SECRET_TTL_SECONDS,
  };
};

export type RealtimeCall = { answerSdp: string; callId: string | null };

/**
 * Exchange the browser's SDP offer for the provider's answer, keeping the call
 * id on this side of the wire.
 *
 * Authenticated with the ephemeral secret rather than the account key: this
 * hop exists to observe the `Location` header, not to re-privilege the call.
 */
export const createRealtimeCall = async (
  clientSecret: string,
  offerSdp: string,
  options: { model: string; signal?: AbortSignal }
): Promise<RealtimeCall> => {
  const response = await fetch(
    `${REALTIME_ROOT}/calls?model=${encodeURIComponent(options.model)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        'Content-Type': 'application/sdp',
      },
      body: offerSdp,
      signal: options.signal,
    }
  );

  if (!response.ok) {
    throw new RealtimeUnavailableError(
      `Realtime call request failed with ${response.status}`,
      response.status === 429 ? 429 : 503,
      response.status === 429 ? 'LIVE_RATE_LIMITED' : 'LIVE_UNAVAILABLE'
    );
  }

  return {
    answerSdp: await response.text(),
    callId: parseCallId(response.headers.get('Location')),
  };
};

/**
 * `/v1/realtime/calls/rtc_123` → `rtc_123`. Null for anything else.
 *
 * Anchored on `/calls/` rather than taking the last path segment. Taking the
 * last segment reads a trailing slash as the id `calls`, which is not an
 * error until it is interpolated back into a hangup URL and quietly stops
 * being able to end anything.
 */
export const parseCallId = (location: string | null): string | null =>
  location?.match(/\/calls\/([A-Za-z0-9_-]{1,128})\/?$/)?.[1] ?? null;

/**
 * End a call at the provider.
 *
 * Best-effort by design: a call that has already ended answers 404, and a
 * session whose id was never captured cannot be hung up at all. Both are
 * recorded as done rather than retried, because the budget was debited at mint
 * and is not waiting on this to be correct.
 */
export const hangupRealtimeCall = async (
  env: RealtimeEnv,
  callId: string
): Promise<boolean> => {
  try {
    const response = await fetch(
      `${REALTIME_ROOT}/calls/${encodeURIComponent(callId)}/hangup`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${requireKey(env)}` },
      }
    );
    return response.ok;
  } catch {
    return false;
  }
};
