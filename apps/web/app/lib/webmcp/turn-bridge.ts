/**
 * Attach the gestures to the turn the prompt bar is already sending.
 *
 * `POST /api/public-agent/turn` accepts `{ messages, tools, turn }` and renders
 * the `turn` half into English before the model sees it — that is what makes
 * "when their words and their gestures conflict, follow the gestures" a rule
 * the model can actually apply. The bar that sends the request is owned by
 * another lane, so rather than leave the rule inert until someone else wires
 * it, this attaches the payload from the outside.
 *
 * It is a shim and it is written to disappear quietly:
 *
 *  - It only touches a same-origin POST to that one path.
 *  - If the body already carries `turn`, it passes straight through. So the
 *    day the bar sends its own payload, this becomes a no-op and can be
 *    deleted with no coordination.
 *  - It fires on the **first** request of a turn only, identified by the last
 *    message being the human's. The loop's later requests end in tool results,
 *    and the journal must not be drained twice for one utterance.
 *  - Anything it does not understand — a Request object, a stream body,
 *    unparseable JSON — is forwarded untouched. It never fails a request it
 *    cannot improve.
 */

import { prepareTurn, toTurnPayload } from './turn';

export const AGENT_TURN_PATH = '/api/public-agent/turn';

type Fetch = typeof globalThis.fetch;

const isAgentTurn = (input: RequestInfo | URL, init?: RequestInit): boolean => {
  if (typeof input !== 'string' && !(input instanceof URL)) return false;
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'POST') return false;
  try {
    return new URL(String(input), window.location.href).pathname === AGENT_TURN_PATH;
  } catch {
    return false;
  }
};

/**
 * Returns the body with the gestures attached, or the original string when
 * this is not a request we should touch.
 *
 * Exported because the decision — which request in a loop counts as the
 * human's turn — is the only part of this file with a way to be wrong.
 */
export const withGestures = (body: string): string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return body;

  const payload = parsed as { messages?: unknown; turn?: unknown };
  if (payload.turn !== undefined) return body;
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return body;
  }

  const last = payload.messages[payload.messages.length - 1] as {
    role?: unknown;
    content?: unknown;
  } | null;
  // Mid-loop the conversation ends in a tool result. Only the human's own
  // message opens a turn, and only a turn has gestures to report.
  if (!last || last.role !== 'user') return body;

  const text = typeof last.content === 'string' ? last.content : undefined;
  return JSON.stringify({
    ...payload,
    turn: toTurnPayload(prepareTurn(text)),
  });
};

/** Wrap `window.fetch`. Returns the detach function. */
export const installTurnBridge = (): (() => void) => {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return () => {};
  }

  // Held unbound so restoring it puts back the identical function another
  // wrapper may be holding a reference to.
  const original = window.fetch;
  const wrapped: Fetch = (input, init) => {
    if (isAgentTurn(input, init) && typeof init?.body === 'string') {
      try {
        return original.call(window, input, {
          ...init,
          body: withGestures(init.body),
        });
      } catch {
        // A gesture payload is never worth losing the turn over.
        return original.call(window, input, init);
      }
    }
    return original.call(window, input, init);
  };

  window.fetch = wrapped;
  return () => {
    // Only unwind our own wrapper: something installed after us owns the slot.
    if (window.fetch === wrapped) window.fetch = original;
  };
};
