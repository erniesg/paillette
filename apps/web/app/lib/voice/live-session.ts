/**
 * The live session: one WebRTC connection that takes text and speech either
 * way and answers in either.
 *
 * This is the half that cannot be tested on a machine with no microphone. It
 * is therefore kept as thin as it can be — every decision worth asserting was
 * pushed into `live-protocol.ts`, and what remains is plumbing: open a peer
 * connection, hand the offer to the Worker, wire the data channel to the
 * protocol, and mute a track.
 *
 * Two things about the shape are deliberate:
 *
 * **The offer goes through our Worker, not to OpenAI.** The provider's answer
 * carries the call id in a header, and that id is the only handle that can
 * stop a running session from the server. Connecting directly would mean the
 * page reporting its own id, which is the same as no ceiling at all.
 *
 * **The microphone track is created muted and stays muted.** Push-to-talk is
 * not a UI convention layered over an open mic; the track is disabled except
 * between press and release, so a page nobody is holding is a page that cannot
 * hear anything, whatever the session thinks.
 */

import {
  buildItemDelete,
  buildResponseCreate,
  buildSessionUpdate,
  buildToolResult,
  buildUserText,
  readLiveEvent,
  type LiveEvent,
  type RegisteredTool,
} from './live-protocol';

export type LiveConnectionState =
  | 'closed'
  | 'connecting'
  | 'open'
  /** Connected, and the human is holding the button. */
  | 'listening'
  /** Connected, and the agent is talking back. */
  | 'speaking'
  | 'failed';

export type LiveSessionHandlers = {
  onState: (state: LiveConnectionState) => void;
  onEvent: (event: LiveEvent) => void;
  /** Budget ran out, or the connection died. One sentence, said once. */
  onClosed: (reason: string | null) => void;
};

export type LiveSession = {
  readonly sessionId: string;
  /** Open the microphone. The track is disabled until this is called. */
  startTalking: () => void;
  /**
   * Close the microphone and commit what was heard, *without* answering it.
   * The reply waits for `commit()` so the grace window can intervene.
   */
  stopTalking: () => void;
  /** Send a typed sentence into the running session. */
  sendText: (text: string, speak: boolean) => void;
  /** Answer the audio already committed, as it stands. */
  commitSpoken: (speak: boolean) => void;
  /** Withdraw committed audio the human has since rewritten or discarded. */
  discardSpoken: (itemId: string) => void;
  /** Return a tool result and, optionally, ask for the reply that follows it. */
  sendToolResult: (callId: string, result: unknown, thenReply: boolean, speak: boolean) => void;
  /** Stop playback now. Interruption, not politeness. */
  interrupt: () => void;
  close: (reason?: string | null) => Promise<void>;
};

/**
 * How often the page asks the Worker whether its grant still holds.
 *
 * Fifteen seconds is a compromise: often enough that a session cannot run far
 * past its budget, rare enough that it is not itself a cost. The grant is
 * already debited, so a missed beat overruns the *stop*, never the ceiling.
 */
const HEARTBEAT_MS = 15_000;

/** Support, in the plainest terms: can this browser do WebRTC and getUserMedia? */
export const isLiveSupported = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.RTCPeerConnection === 'function' &&
  typeof navigator !== 'undefined' &&
  typeof navigator.mediaDevices?.getUserMedia === 'function';

type MintedSession = {
  sessionId: string;
  token: string;
  grantedSeconds: number;
};

const mint = async (): Promise<MintedSession> => {
  const response = await fetch('/api/public-live/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    data?: MintedSession;
    error?: { message?: string };
  };
  if (!response.ok || !payload.success || !payload.data) {
    // The Worker's refusals are already written to be read by a person — the
    // per-caller one and the site-wide one say different true things — so they
    // are relayed rather than replaced with a generic sentence.
    throw new Error(
      payload.error?.message ?? 'Live audio is unavailable right now.'
    );
  }
  return payload.data;
};

export const openLiveSession = async (
  tools: RegisteredTool[],
  handlers: LiveSessionHandlers
): Promise<LiveSession> => {
  handlers.onState('connecting');

  const minted = await mint();

  let microphone: MediaStream;
  try {
    microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    // A refused microphone is a decision, not a fault. Give the grant back so
    // the visitor is not charged for a permission dialog they said no to.
    await closeOnServer(minted.sessionId);
    throw error instanceof Error
      ? error
      : new Error('The microphone is unavailable.');
  }

  const connection = new RTCPeerConnection();
  const audio = document.createElement('audio');
  audio.autoplay = true;
  connection.ontrack = (event) => {
    audio.srcObject = event.streams[0] ?? null;
  };

  const track = microphone.getAudioTracks()[0] ?? null;
  // Muted from the first instant it exists. Between `openLiveSession` and the
  // first press there is no moment at which this page is listening.
  if (track) track.enabled = false;
  connection.addTrack(track as MediaStreamTrack, microphone);

  const channel = connection.createDataChannel('oai-events');

  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const send = (message: unknown) => {
    if (channel.readyState !== 'open') return;
    channel.send(JSON.stringify(message));
  };

  const stop = async (reason: string | null) => {
    if (closed) return;
    closed = true;
    if (heartbeat !== null) clearInterval(heartbeat);
    try {
      microphone.getTracks().forEach((entry) => entry.stop());
      connection.close();
    } catch {
      // Tearing down twice is not an error worth telling anybody about.
    }
    audio.srcObject = null;
    await closeOnServer(minted.sessionId);
    handlers.onState('closed');
    handlers.onClosed(reason);
  };

  channel.onmessage = (event) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(event.data));
    } catch {
      return;
    }
    for (const live of readLiveEvent(parsed)) {
      if (live.kind === 'ignored') continue;
      if (live.kind === 'ready') handlers.onState('open');
      handlers.onEvent(live);
    }
  };

  channel.onopen = () => {
    // The page's own tool schemas become the session's functions. Nothing about
    // the tool surface is restated here — the same twenty-five tools the human
    // drives by hand, offered to the session as they stand.
    send(buildSessionUpdate(tools));
  };

  connection.onconnectionstatechange = () => {
    const state = connection.connectionState;
    if (state === 'failed' || state === 'disconnected') {
      handlers.onState('failed');
      void stop('The live connection dropped. Typing still works.');
    }
  };

  const offer = await connection.createOffer();
  await connection.setLocalDescription(offer);

  const answer = await fetch(
    `/api/public-live/call?session=${encodeURIComponent(minted.sessionId)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp',
        'X-Live-Token': minted.token,
      },
      body: offer.sdp ?? '',
    }
  );
  if (!answer.ok) {
    await stop(null);
    throw new Error('Live audio is unavailable right now.');
  }
  await connection.setRemoteDescription({
    type: 'answer',
    sdp: await answer.text(),
  });

  heartbeat = setInterval(() => {
    void (async () => {
      const verdict = await beat(minted.sessionId);
      if (verdict && !verdict.open) await stop(verdict.reason);
    })();
  }, HEARTBEAT_MS);

  return {
    sessionId: minted.sessionId,

    startTalking: () => {
      // Anything the agent is still saying stops the moment the human speaks.
      send({ type: 'response.cancel' });
      send({ type: 'output_audio_buffer.clear' });
      send({ type: 'input_audio_buffer.clear' });
      if (track) track.enabled = true;
      handlers.onState('listening');
    },

    stopTalking: () => {
      if (track) track.enabled = false;
      // Commit without `response.create`. That gap is the whole feature: the
      // commit is what produces a transcript, and the transcript is what the
      // grace bar gives the human 1.2 seconds to rewrite before anything is
      // answered.
      send({ type: 'input_audio_buffer.commit' });
      handlers.onState('open');
    },

    sendText: (text, speak) => {
      send(buildUserText(text));
      send(buildResponseCreate(speak));
      if (speak) handlers.onState('speaking');
    },

    commitSpoken: (speak) => {
      send(buildResponseCreate(speak));
      if (speak) handlers.onState('speaking');
    },

    discardSpoken: (itemId) => send(buildItemDelete(itemId)),

    sendToolResult: (callId, result, thenReply, speak) => {
      send(buildToolResult(callId, result));
      if (thenReply) send(buildResponseCreate(speak));
    },

    interrupt: () => {
      send({ type: 'response.cancel' });
      send({ type: 'output_audio_buffer.clear' });
      handlers.onState('open');
    },

    close: (reason = null) => stop(reason),
  };
};

const beat = async (
  sessionId: string
): Promise<{ open: boolean; reason: string | null } | null> => {
  try {
    const response = await fetch('/api/public-live/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      data?: { open?: boolean; reason?: string | null };
    };
    // A 404 means the Worker has already closed and settled this session —
    // which is a stop, not a network hiccup to shrug at.
    if (response.status === 404) {
      return { open: false, reason: 'Live audio time is up. Typing still works.' };
    }
    if (!response.ok || !payload.data) return null;
    return {
      open: payload.data.open !== false,
      reason: payload.data.reason ?? null,
    };
  } catch {
    // A dropped beat is not a verdict. The grant was debited up front, so
    // guessing "closed" here would cost the visitor seconds they still own.
    return null;
  }
};

const closeOnServer = async (sessionId: string): Promise<void> => {
  try {
    await fetch('/api/public-live/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      keepalive: true,
    });
  } catch {
    // The server settles it on the next sweep regardless. This is the polite
    // path, not the enforcing one.
  }
};
