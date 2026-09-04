/**
 * One conversation, text or speech, either way.
 *
 * The transport is mocked here and that is the honest boundary: a peer
 * connection, a media track and a microphone cannot be exercised on a headless
 * machine, so what these tests hold is the component's half of the contract —
 * which button opens what, where a transcript lands, what happens to spoken
 * audio when somebody types over it, and that the typed path is untouched when
 * none of it is available.
 *
 * What they cannot tell you is whether a real session ever connects. That has
 * to be checked by a human with a real microphone, and the report says so.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GRACE_MS } from '~/lib/voice/utterance';
import { getWebMcpState } from '~/lib/webmcp/store';
import type { LiveEvent } from '~/lib/voice/live-protocol';

const openLiveSession = vi.fn();
const isLiveSupported = vi.fn(() => true);

vi.mock('~/lib/voice/live-session', () => ({
  openLiveSession: (...args: unknown[]) => openLiveSession(...args),
  isLiveSupported: () => isLiveSupported(),
}));

const { AgentPrompt } = await import('../agent-prompt');

const PLACEHOLDER = 'Ask for what you want to see…';
const MIC = 'Hold to speak';

/** Every message the component sent into the session, in order. */
type Sent = { call: string; args: unknown[] };

const makeSession = () => {
  const sent: Sent[] = [];
  const record =
    (call: string) =>
    (...args: unknown[]) => {
      sent.push({ call, args });
    };
  return {
    sent,
    sessionId: 'sess_test',
    startTalking: record('startTalking'),
    stopTalking: record('stopTalking'),
    sendText: record('sendText'),
    commitSpoken: record('commitSpoken'),
    discardSpoken: record('discardSpoken'),
    sendToolResult: record('sendToolResult'),
    interrupt: record('interrupt'),
    close: vi.fn(async () => {}),
  };
};

let handlers: {
  onState: (state: string) => void;
  onEvent: (event: LiveEvent) => void;
  onClosed: (reason: string | null) => void;
} | null = null;

const setModelContext = (tools: unknown[] = []) => {
  (document as { modelContext?: unknown }).modelContext = {
    getTools: async () => tools,
  };
};

const stubTurnFetch = () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      success: true,
      data: { message: { role: 'assistant', content: 'done' } },
    }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

/**
 * Open a session the way the page does: the first hold starts the connection,
 * and the one after it is the first that can actually talk.
 */
const connect = async (session: ReturnType<typeof makeSession>) => {
  openLiveSession.mockImplementation(async (_tools: unknown, given: never) => {
    handlers = given;
    return session;
  });

  render(<AgentPrompt />);
  await screen.findByPlaceholderText(PLACEHOLDER);

  await act(async () => {
    fireEvent.pointerDown(screen.getByLabelText(MIC));
  });
  fireEvent.pointerUp(screen.getByLabelText(MIC));
  await waitFor(() => expect(openLiveSession).toHaveBeenCalled());
};

const hold = async () => {
  await act(async () => {
    fireEvent.pointerDown(screen.getByLabelText(MIC));
  });
};

const release = () =>
  fireEvent.pointerUp(screen.getByLabelText('Listening — release to send'));

/** The session reporting what it heard, which is what the field receives. */
const transcribe = (text: string, itemId = 'item_1') =>
  act(() => {
    handlers?.onEvent({ kind: 'transcript', text, itemId });
  });

beforeEach(() => {
  handlers = null;
  isLiveSupported.mockReturnValue(true);
  openLiveSession.mockReset();
  setModelContext();
  stubTurnFetch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (document as { modelContext?: unknown }).modelContext;
  delete (window as unknown as { webkitSpeechRecognition?: unknown })
    .webkitSpeechRecognition;
});

describe('the typed path, with no session', () => {
  it('still offers the bar when live audio is unavailable', async () => {
    // The whole point of the ordering: text is primary, and a browser with no
    // WebRTC and no recogniser is a browser that types.
    isLiveSupported.mockReturnValue(false);
    render(<AgentPrompt />);

    const field = await screen.findByPlaceholderText(PLACEHOLDER);
    expect(field).toBeInTheDocument();
    expect(screen.queryByLabelText(MIC)).not.toBeInTheDocument();
    expect(openLiveSession).not.toHaveBeenCalled();
  });

  it('sends a typed instruction down the turn route when no session is open', async () => {
    isLiveSupported.mockReturnValue(false);
    const fetchMock = stubTurnFetch();
    render(<AgentPrompt />);

    const field = await screen.findByPlaceholderText(PLACEHOLDER);
    fireEvent.change(field, { target: { value: 'storms at sea' } });
    fireEvent.submit(field.closest('form')!);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/public-agent/turn',
        expect.anything()
      )
    );
  });

  it('does not re-dial on every press once a session has refused', async () => {
    openLiveSession.mockRejectedValue(new Error('no microphone'));
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    for (let press = 0; press < 3; press += 1) {
      await hold();
      fireEvent.pointerUp(screen.getByLabelText(MIC));
    }

    // One attempt per page load is enough to learn the answer. A button that
    // silently re-dials on every hold is a button that stutters.
    expect(openLiveSession).toHaveBeenCalledTimes(1);
  });

  it('says nothing about a failure the human cannot act on', async () => {
    openLiveSession.mockRejectedValue(new Error('ICE negotiation failed'));
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    await hold();
    fireEvent.pointerUp(screen.getByLabelText(MIC));

    await waitFor(() => expect(openLiveSession).toHaveBeenCalled());
    // The page does not narrate its own plumbing. The microphone still works
    // through the recogniser and the glyph simply never wakes up.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does say the one refusal that is the visitor’s own business', async () => {
    openLiveSession.mockRejectedValue(
      new Error('You’ve used this hour’s live-audio budget. Typing still works.')
    );
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    await hold();
    fireEvent.pointerUp(screen.getByLabelText(MIC));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Typing still works'
    );
  });
});

describe('a live session, holding both modalities', () => {
  it('opens the microphone on hold and commits without answering on release', async () => {
    const session = makeSession();
    await connect(session);

    await hold();
    release();

    const calls = session.sent.map((entry) => entry.call);
    expect(calls).toContain('startTalking');
    expect(calls).toContain('stopTalking');
    // Crucially *not* a reply. Committing produces the transcript; the grace
    // window is what stands between the transcript and an answer.
    expect(calls).not.toContain('commitSpoken');
  });

  it('lands the transcript in the same field the keyboard writes to', async () => {
    const session = makeSession();
    await connect(session);

    await hold();
    release();
    transcribe('something warm for above the sofa');

    await waitFor(() =>
      expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveValue(
        'something warm for above the sofa'
      )
    );
    // And the countdown is running, visibly.
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('answers the audio itself when the sentence is sent as heard', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const session = makeSession();
    await connect(session);

    await hold();
    release();
    transcribe('warmer');
    await act(async () => {
      vi.advanceTimersByTime(GRACE_MS + 20);
    });

    // Re-sending it as text would throw away everything the model can hear
    // that a transcript cannot carry.
    const sent = session.sent.filter((entry) => entry.call === 'commitSpoken');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.args[0]).toBe(true); // spoken in, spoken out
    expect(session.sent.some((entry) => entry.call === 'sendText')).toBe(false);
  });

  it('withdraws the audio and sends the words when the transcript is corrected', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const session = makeSession();
    await connect(session);

    await hold();
    release();
    transcribe('any in us in here', 'item_7');

    // Voice will write "any in us in here" for Inness. Fixing it the old way —
    // clicking the word and retyping — is the whole reason the grace window
    // survived into the live path.
    const field = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(field, { target: { value: 'Inness' } });
    fireEvent.submit(field.closest('form')!);
    await act(async () => {
      vi.advanceTimersByTime(20);
    });

    expect(
      session.sent.find((entry) => entry.call === 'discardSpoken')?.args[0]
    ).toBe('item_7');
    const text = session.sent.find((entry) => entry.call === 'sendText');
    expect(text?.args[0]).toBe('Inness');
    // Still a spoken turn: the sentence started in someone's mouth, so the
    // reply belongs in their ears.
    expect(text?.args[1]).toBe(true);
  });

  it('makes Escape mean the utterance never happened, inside the session too', async () => {
    const session = makeSession();
    await connect(session);

    await hold();
    release();
    transcribe('forget it', 'item_3');

    fireEvent.keyDown(window, { key: 'Escape' });

    // Audio left standing in the conversation would be answered alongside
    // whatever they say next.
    expect(
      session.sent.find((entry) => entry.call === 'discardSpoken')?.args[0]
    ).toBe('item_3');
    await waitFor(() =>
      expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveValue('')
    );
  });

  it('answers a typed message in the open session rather than on the old path', async () => {
    const session = makeSession();
    const fetchMock = stubTurnFetch();
    await connect(session);

    const field = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(field, { target: { value: 'colder' } });
    fireEvent.submit(field.closest('form')!);

    await waitFor(() =>
      expect(session.sent.some((entry) => entry.call === 'sendText')).toBe(true)
    );
    const text = session.sent.find((entry) => entry.call === 'sendText');
    expect(text?.args).toEqual(['colder', false]); // typed in, typed out
    // The turn route is not consulted. Two paths is exactly what this replaced.
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/public-agent/turn',
      expect.anything()
    );
  });
});

describe('the session driving the page’s own tools', () => {
  it('runs a tool call in the browser and hands the result back', async () => {
    const executed: { name: string; args: unknown }[] = [];
    setModelContext([
      {
        name: 'search_artworks',
        execute: async (args: unknown) => {
          executed.push({ name: 'search_artworks', args });
          return { ok: true, count: 12 };
        },
      },
    ]);

    const session = makeSession();
    await connect(session);

    await act(async () => {
      handlers?.onEvent({
        kind: 'tool',
        callId: 'call_1',
        name: 'search_artworks',
        args: { query: 'harbour' },
      });
      handlers?.onEvent({ kind: 'response-done' });
    });

    // The same tool, in the same document, that the human drives by hand.
    // There is no agent-only path — that symmetry is the argument.
    await waitFor(() => expect(executed).toHaveLength(1));
    expect(executed[0]!.args).toEqual({ query: 'harbour' });

    const result = session.sent.find((entry) => entry.call === 'sendToolResult');
    expect(result?.args[0]).toBe('call_1');
    expect(result?.args[1]).toEqual({ ok: true, count: 12 });
  });

  it('asks for one reply after every result is in, not one per tool', async () => {
    setModelContext([
      { name: 'get_view_context', execute: async () => ({ ok: true }) },
      { name: 'set_results', execute: async () => ({ ok: true }) },
    ]);

    const session = makeSession();
    await connect(session);

    await act(async () => {
      handlers?.onEvent({ kind: 'tool', callId: 'a', name: 'get_view_context', args: {} });
      handlers?.onEvent({ kind: 'tool', callId: 'b', name: 'set_results', args: {} });
      handlers?.onEvent({ kind: 'response-done' });
    });

    await waitFor(() =>
      expect(
        session.sent.filter((entry) => entry.call === 'sendToolResult')
      ).toHaveLength(2)
    );
    // Asking per tool would have the agent talking over its own work.
    expect(
      session.sent.filter((entry) => entry.call === 'commitSpoken')
    ).toHaveLength(1);
  });

  it('gives a failing tool back as a result rather than losing the turn', async () => {
    setModelContext([
      {
        name: 'redeal',
        execute: async () => {
          throw new Error('nothing is flagged');
        },
      },
    ]);

    const session = makeSession();
    await connect(session);

    await act(async () => {
      handlers?.onEvent({ kind: 'tool', callId: 'c', name: 'redeal', args: {} });
      handlers?.onEvent({ kind: 'response-done' });
    });

    await waitFor(() =>
      expect(
        session.sent.find((entry) => entry.call === 'sendToolResult')?.args[1]
      ).toEqual({ ok: false, error: 'nothing is flagged' })
    );
  });
});

describe('what the glyph is told', () => {
  it('carries the connection on the shared store, not in new chrome', async () => {
    const session = makeSession();
    await connect(session);

    act(() => handlers?.onState('open'));
    expect(getWebMcpState().live).toBe('on');

    act(() => handlers?.onState('listening'));
    expect(getWebMcpState().live).toBe('listening');

    act(() => handlers?.onClosed(null));
    expect(getWebMcpState().live).toBe('off');
  });

  it('tells the human once, in one sentence, when the budget runs out', async () => {
    const session = makeSession();
    await connect(session);

    act(() =>
      handlers?.onClosed('Live audio time is up. Typing still works.')
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Live audio time is up. Typing still works.'
    );
    // And the bar is still there, still typeable. Never a dead control.
    expect(screen.getByPlaceholderText(PLACEHOLDER)).not.toBeDisabled();
  });
});
