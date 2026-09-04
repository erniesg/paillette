import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentPrompt } from '../agent-prompt';
import { GRACE_MS } from '~/lib/voice/utterance';
import { setFocusedArtwork, setSelection } from '~/lib/webmcp/store';
import { setFlag, __resetFlagsForTest } from '~/lib/webmcp/flags';
import { rememberArtworks, __resetArtworkIndexForTest } from '~/lib/webmcp/artwork-index';

const PLACEHOLDER = 'Ask for what you want to see…';
const MIC = 'Hold to speak';

type RecognitionInstance = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<unknown> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

let recognitionInstance: RecognitionInstance | null = null;

/** Hands the newest stub to the test. Kept out of the constructor body so the
 *  instance is never aliased to a variable from inside itself. */
const remember = (instance: RecognitionInstance) => {
  recognitionInstance = instance;
};

const installRecognition = () => {
  recognitionInstance = null;
  // Deliberately starts on the wrong settings, so a test asserting
  // `interimResults` or `continuous` is reading what the component set rather
  // than what the stub happened to default to.
  class Recognition {
    lang = '';
    interimResults = false;
    continuous = false;
    onresult: RecognitionInstance['onresult'] = null;
    onend: RecognitionInstance['onend'] = null;
    onerror: RecognitionInstance['onerror'] = null;
    start = vi.fn();
    stop = vi.fn();
    constructor() {
      remember(this);
    }
  }
  (
    window as unknown as { webkitSpeechRecognition?: unknown }
  ).webkitSpeechRecognition = Recognition;
};

const setModelContext = (value: unknown) => {
  (document as { modelContext?: unknown }).modelContext = value;
};

const stubFetch = (note = '') => {
  const fetchMock = vi.fn(async (_url: string, _init: { body: string }) => ({
    ok: true,
    json: async () => ({
      success: true,
      data: { message: { role: 'assistant', content: note } },
    }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

/** The browser's voice, faked. Collects whatever was said aloud. */
const installSynthesis = () => {
  const spoken: string[] = [];
  const synthesis = { speaking: false, pending: false, cancel: vi.fn() };
  (window as unknown as { speechSynthesis: unknown }).speechSynthesis = {
    ...synthesis,
    speak: (utterance: { text: string }) => spoken.push(utterance.text),
  };
  (
    window as unknown as { SpeechSynthesisUtterance: unknown }
  ).SpeechSynthesisUtterance = function (this: { text: string }, text: string) {
    this.text = text;
  };
  return { spoken };
};

const alternative = (transcript: string) => [{ transcript }];
const said = (transcript: string, isFinal: boolean) =>
  Object.assign(alternative(transcript), { isFinal });

const recogniser = () => recognitionInstance as unknown as RecognitionInstance;

/**
 * Put a work on the shared canvas the way the page does, so that "this one" has
 * something to point at. Deixis reads the same store `get_view_context` reads.
 */
const openArtwork = () =>
  setFocusedArtwork({
    origin: 'human',
    at: 0,
    artwork: {
      id: 'nga-1',
      title: 'Lumber Schooners at Evening on Penobscot Bay',
      artist: 'Fitz Henry Lane',
      thumbnailUrl: 'https://example.test/nga-1.jpg',
    },
  } as unknown as Parameters<typeof setFocusedArtwork>[0]);

/** Hold the mic control down. Push-to-talk: this is where listening starts. */
const hold = () => fireEvent.pointerDown(screen.getByLabelText(MIC));
/** Let go. This starts the grace countdown; it does not send. */
const release = () =>
  fireEvent.pointerUp(screen.getByLabelText('Listening — release to send'));

const heard = (transcript: string, isFinal = false) =>
  act(() => {
    recogniser().onresult?.({ results: [said(transcript, isFinal)] });
  });

afterEach(() => {
  setFocusedArtwork(null);
  __resetFlagsForTest();
  setSelection([]);
  __resetArtworkIndexForTest();
  delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  delete (window as unknown as { SpeechSynthesisUtterance?: unknown })
    .SpeechSynthesisUtterance;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (document as { modelContext?: unknown }).modelContext;
  delete (window as unknown as { webkitSpeechRecognition?: unknown })
    .webkitSpeechRecognition;
  recognitionInstance = null;
});

describe('AgentPrompt', () => {
  it('renders nothing when the page has no model context', () => {
    render(<AgentPrompt />);
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(MIC)).not.toBeInTheDocument();
  });

  it('hides the mic button when there is no speech recognition', async () => {
    setModelContext({ getTools: async () => [] });
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);
    expect(screen.queryByLabelText(MIC)).not.toBeInTheDocument();
  });

  it('writes an interim transcript into the input as it arrives', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    hold();
    expect(recogniser().interimResults).toBe(true);
    // Push-to-talk means the human decides where the sentence ends, so the
    // recogniser is not allowed to end it at the first pause.
    expect(recogniser().continuous).toBe(true);

    heard('something warm');
    await waitFor(() =>
      expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveValue(
        'something warm'
      )
    );
  });

  it('draws words still being heard at a lower contrast than settled ones', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    const { container } = render(<AgentPrompt />);
    const field = await screen.findByPlaceholderText(PLACEHOLDER);

    fireEvent.change(field, { target: { value: 'warm landscape' } });
    hold();
    heard('without people');

    await waitFor(() =>
      expect(container.querySelector('.text-neutral-500')).toHaveTextContent(
        'without people'
      )
    );
    expect(container.querySelector('.text-white')).toHaveTextContent(
      'warm landscape'
    );
    expect(field).toHaveClass('text-transparent');
  });

  it('lets speech extend typed text instead of replacing it', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    render(<AgentPrompt />);
    const field = await screen.findByPlaceholderText(PLACEHOLDER);

    fireEvent.change(field, { target: { value: 'warm landscape' } });
    hold();
    heard('without people');

    await waitFor(() =>
      expect(field).toHaveValue('warm landscape without people')
    );
  });

  it('lets typing take ownership of spoken words rather than losing them', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    render(<AgentPrompt />);
    const field = await screen.findByPlaceholderText(PLACEHOLDER);

    hold();
    heard('any in us in here');
    await waitFor(() => expect(field).toHaveValue('any in us in here'));

    // Text is the ground truth: editing the transcript is just editing.
    fireEvent.change(field, { target: { value: 'Inness' } });
    expect(field).toHaveValue('Inness');
    expect(field).toHaveClass('text-white');
  });

  it('does not send on release — it starts a visible countdown', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    const fetchMock = stubFetch();
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    vi.useFakeTimers();
    hold();
    heard('something warm for above the sofa', true);
    release();

    // The bar is on screen and the turn has not gone anywhere.
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(GRACE_MS / 2);
    });
    const half = Number(
      screen.getByRole('progressbar').getAttribute('aria-valuenow')
    );
    expect(half).toBeGreaterThan(30);
    expect(half).toBeLessThan(70);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('commits the utterance once the grace bar runs out', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    const fetchMock = stubFetch();
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    vi.useFakeTimers();
    hold();
    heard('something warm for above the sofa', true);
    release();
    await act(async () => {
      vi.advanceTimersByTime(GRACE_MS + 20);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/public-agent/turn',
      expect.objectContaining({ method: 'POST' })
    );
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveValue('');
    expect(
      screen.getByText('something warm for above the sofa')
    ).toBeInTheDocument();
  });

  it('stops the countdown when the human reaches for the field', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    const fetchMock = stubFetch();
    render(<AgentPrompt />);
    const field = await screen.findByPlaceholderText(PLACEHOLDER);

    vi.useFakeTimers();
    hold();
    heard('something warm', true);
    release();
    fireEvent.focus(field);

    act(() => {
      vi.advanceTimersByTime(GRACE_MS * 3);
    });

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(field).toHaveValue('something warm');
    // The bar is the countdown; this is the same fact for a screen reader.
    expect(screen.getByRole('status')).toHaveTextContent(
      /Enter to send, Escape to discard/
    );
  });

  it('takes Esc wherever focus is, because release does not move it', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    const fetchMock = stubFetch();
    render(<AgentPrompt />);
    const field = await screen.findByPlaceholderText(PLACEHOLDER);

    vi.useFakeTimers();
    hold();
    heard('something warm', true);
    release();
    // Focus is on the mic control, not the field — the state a human is in
    // immediately after speaking.
    fireEvent.keyDown(document.body, { key: 'Escape' });

    act(() => {
      vi.advanceTimersByTime(GRACE_MS * 3);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(field).toHaveValue('');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('discards the utterance on Esc, restoring what the field held', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    const fetchMock = stubFetch();
    render(<AgentPrompt />);
    const field = await screen.findByPlaceholderText(PLACEHOLDER);

    fireEvent.change(field, { target: { value: 'warm landscape' } });
    vi.useFakeTimers();
    hold();
    heard('and absolutely nothing like what I meant', true);
    release();
    fireEvent.keyDown(field, { key: 'Escape' });

    act(() => {
      vi.advanceTimersByTime(GRACE_MS * 3);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(field).toHaveValue('warm landscape');
  });

  it('sends immediately on Enter rather than waiting out the grace', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    const fetchMock = stubFetch();
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    vi.useFakeTimers();
    hold();
    heard('something warm', true);
    release();
    await act(async () => {
      fireEvent.submit(
        screen.getByRole('button', { name: 'Ask' }).closest('form')!
      );
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('keeps words the recogniser never settled, so a short press loses nothing', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    const fetchMock = stubFetch();
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    vi.useFakeTimers();
    hold();
    heard('warmer please');
    release();
    await act(async () => {
      vi.advanceTimersByTime(GRACE_MS + 20);
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(screen.getByText('warmer please')).toBeInTheDocument();
  });

  it('holding Space starts listening, and releasing it stops', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    vi.useFakeTimers();
    fireEvent.keyDown(document.body, { code: 'Space' });
    expect(
      screen.getByLabelText('Listening — release to send')
    ).toBeInTheDocument();
    expect(recogniser().start).toHaveBeenCalledTimes(1);

    fireEvent.keyUp(document.body, { code: 'Space' });
    expect(screen.getByLabelText(MIC)).toBeInTheDocument();
    expect(recogniser().stop).toHaveBeenCalled();
  });

  it('leaves the space bar alone while someone is typing in the field', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    render(<AgentPrompt />);
    const field = await screen.findByPlaceholderText(PLACEHOLDER);

    act(() => field.focus());
    fireEvent.keyDown(field, { code: 'Space' });

    expect(screen.getByLabelText(MIC)).toBeInTheDocument();
    expect(recognitionInstance).toBeNull();
  });

  it('shows what "this one" resolved to while the countdown runs', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    stubFetch();
    openArtwork();
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    vi.useFakeTimers();
    hold();
    heard('more like this one but brighter', true);
    release();

    // The picture is the whole statement — no caption restating the phrase.
    expect(
      screen.getByText('Lumber Schooners at Evening on Penobscot Bay')
    ).toBeInTheDocument();
    expect(screen.queryByText(/“this one” =/)).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('sends the binding to the agent with the id, alongside the words as spoken', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    const fetchMock = stubFetch();
    openArtwork();
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    vi.useFakeTimers();
    hold();
    heard('more like this one but brighter', true);
    release();
    await act(async () => {
      vi.advanceTimersByTime(GRACE_MS + 20);
    });

    const sent = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(sent?.body ?? '{}') as {
      messages: Array<{ role: string; content: string }>;
    };
    const turn = body.messages.find((message) => message.role === 'user');
    expect(turn?.content).toContain('more like this one but brighter');
    expect(turn?.content).toContain('nga-1');
  });

  it('says what it could not resolve rather than binding it silently', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    stubFetch();
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    vi.useFakeTimers();
    hold();
    heard('something between these two', true);
    release();

    // A mark, not a sentence: the phrase keeps its place in the row as a
    // dashed outline with no picture in it.
    const gap = screen.getByText('these two');
    expect(gap).toBeInTheDocument();
    expect(gap.className).toMatch(/border-dashed/);
  });

  it('starts the countdown when a transcript arrives after release', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    stubFetch();
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    vi.useFakeTimers();
    hold();
    // Release beats the recogniser's flush — common on a real machine.
    release();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    heard('something warm', true);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveValue(
      'something warm'
    );
  });

  it('puts no countdown on screen for a tap that heard nothing', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    const fetchMock = stubFetch();
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    vi.useFakeTimers();
    hold();
    release();
    act(() => {
      vi.advanceTimersByTime(GRACE_MS * 4);
    });

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    // And a transcript that turns up long afterwards must not start sending.
    heard('a stray result from a minute ago', true);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('resolves deixis for a typed utterance, with the mic never touched', async () => {
    setModelContext({ getTools: async () => [] });
    // No speech recognition installed at all: text is the primary path.
    stubFetch();
    openArtwork();
    render(<AgentPrompt />);
    const field = await screen.findByPlaceholderText(PLACEHOLDER);

    fireEvent.change(field, { target: { value: 'more like this one' } });

    await waitFor(() =>
      expect(
        screen.getByText('Lumber Schooners at Evening on Penobscot Bay')
      ).toBeInTheDocument()
    );
    expect(screen.queryByLabelText(MIC)).not.toBeInTheDocument();
  });

  it('sends a typed turn with its bindings, and stays silent', async () => {
    setModelContext({ getTools: async () => [] });
    const { spoken } = installSynthesis();
    const fetchMock = stubFetch('Five warm, calm options.');
    openArtwork();
    render(<AgentPrompt />);
    const field = await screen.findByPlaceholderText(PLACEHOLDER);

    fireEvent.change(field, { target: { value: 'more like this one' } });
    await act(async () => {
      fireEvent.submit(field.closest('form')!);
    });

    const sent = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(sent?.body ?? '{}') as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(
      body.messages.find((message) => message.role === 'user')?.content
    ).toContain('nga-1');
    expect(spoken).toEqual([]);
  });

  it('speaks the note back after a spoken turn, one sentence of it', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    const { spoken } = installSynthesis();
    stubFetch('Five warm, calm options. I dropped the two with figures in.');
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    vi.useFakeTimers();
    hold();
    heard('something warm for above the sofa', true);
    release();
    await act(async () => {
      vi.advanceTimersByTime(GRACE_MS + 20);
    });

    expect(spoken).toEqual(['Five warm, calm options.']);
  });

  it('stays silent after a typed turn — text in, text out', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    const { spoken } = installSynthesis();
    stubFetch('Five warm, calm options.');
    render(<AgentPrompt />);
    const field = await screen.findByPlaceholderText(PLACEHOLDER);

    fireEvent.change(field, { target: { value: 'something warm' } });
    await act(async () => {
      fireEvent.submit(field.closest('form')!);
    });

    // The note is on screen either way. Only the channel differs.
    expect(screen.getByText('Five warm, calm options.')).toBeInTheDocument();
    expect(spoken).toEqual([]);
  });

  it('is silent where the browser cannot speak', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    stubFetch('Five warm, calm options.');
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    vi.useFakeTimers();
    hold();
    heard('something warm', true);
    release();
    await act(async () => {
      vi.advanceTimersByTime(GRACE_MS + 20);
    });

    expect(screen.getByText('Five warm, calm options.')).toBeInTheDocument();
  });

  it('will not talk over a caption read-aloud somebody pressed play on', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    const { spoken } = installSynthesis();
    (
      window as unknown as { speechSynthesis: { speaking: boolean } }
    ).speechSynthesis.speaking = true;
    stubFetch('Five warm, calm options.');
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    vi.useFakeTimers();
    hold();
    heard('something warm', true);
    release();
    await act(async () => {
      vi.advanceTimersByTime(GRACE_MS + 20);
    });

    expect(spoken).toEqual([]);
  });

  it('does not put a JSON parser error in front of anybody', async () => {
    setModelContext({ getTools: async () => [] });
    // What an edge error page or a stale deploy actually returns.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token \'<\'');
        },
      }))
    );
    render(<AgentPrompt />);
    const field = await screen.findByPlaceholderText(PLACEHOLDER);

    fireEvent.change(field, { target: { value: 'something warm' } });
    await act(async () => {
      fireEvent.submit(field.closest('form')!);
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/replied with something unreadable/i);
    expect(alert).not.toHaveTextContent(/Unexpected token/);
    // And the bar is usable again rather than stuck on "Working…".
    expect(field).not.toBeDisabled();
  });

  it('sends what the hands did, not only what was typed', async () => {
    setModelContext({ getTools: async () => [] });
    const fetchMock = stubFetch('Following the picks.');
    // Two works on the page, one of them rejected by the human.
    rememberArtworks([
      {
        id: 'nga-2',
        galleryId: 'nga',
        title: "Estuary at Day's End",
        artist: 'Fitz Henry Lane',
        imageUrl: null,
        similarity: 1,
      },
    ] as unknown as Parameters<typeof rememberArtworks>[0]);
    setFlag('nga-2', 'reject', { by: 'human' });

    render(<AgentPrompt />);
    const field = await screen.findByPlaceholderText(PLACEHOLDER);
    fireEvent.change(field, { target: { value: 'something warm' } });
    await act(async () => {
      fireEvent.submit(field.closest('form')!);
    });

    const sent = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(sent?.body ?? '{}') as {
      turn?: { flagsDelta?: Array<{ artworkId: string; title?: string; to: string | null }> };
    };
    const delta = body.turn?.flagsDelta ?? [];
    expect(delta).toHaveLength(1);
    expect(delta[0]?.artworkId).toBe('nga-2');
    expect(delta[0]?.to).toBe('reject');
    // The title is what lets the model say *what* was rejected rather than
    // reciting an id back at somebody.
    expect(delta[0]?.title).toMatch(/Estuary at Day's End/);
  });

  it('reports the gestures once, not on every tool round trip', async () => {
    setModelContext({ getTools: async () => [] });
    rememberArtworks([
      { id: 'nga-2', galleryId: 'nga', title: 'A', artist: 'B', imageUrl: null, similarity: 1 },
    ] as unknown as Parameters<typeof rememberArtworks>[0]);
    setFlag('nga-2', 'pick', { by: 'human' });

    let call = 0;
    const fetchMock = vi.fn(async (_url: string, _init: { body: string }) => {
      call += 1;
      return {
        ok: true,
        status: 200,
        json: async () =>
          call === 1
            ? {
                success: true,
                data: {
                  message: {
                    role: 'assistant',
                    tool_calls: [
                      { id: 't1', function: { name: 'get_view_context', arguments: '{}' } },
                    ],
                  },
                },
              }
            : { success: true, data: { message: { role: 'assistant', content: 'Done.' } } },
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentPrompt />);
    const field = await screen.findByPlaceholderText(PLACEHOLDER);
    fireEvent.change(field, { target: { value: 'something warm' } });
    await act(async () => {
      fireEvent.submit(field.closest('form')!);
    });

    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1]?.body ?? '{}'));
    expect(bodies.length).toBeGreaterThan(1);
    expect(bodies[0].turn?.flagsDelta).toHaveLength(1);
    // Restating them would read as the human having flagged it all over again.
    expect(bodies[1].turn).toBeUndefined();
  });

  it('names one work but lets several speak for themselves', async () => {
    setModelContext({ getTools: async () => [] });
    stubFetch();
    rememberArtworks([
      { id: 'nga-1', galleryId: 'nga', title: 'Salt Marsh', artist: 'Heade', imageUrl: 'a.jpg', thumbnailUrl: 'a.jpg', similarity: 1 },
      { id: 'nga-2', galleryId: 'nga', title: 'Lake George', artist: 'Kensett', imageUrl: 'b.jpg', thumbnailUrl: 'b.jpg', similarity: 1 },
    ] as unknown as Parameters<typeof rememberArtworks>[0]);
    setSelection(['nga-1', 'nga-2']);

    const { container } = render(<AgentPrompt />);
    const field = await screen.findByPlaceholderText(PLACEHOLDER);
    fireEvent.change(field, { target: { value: 'between these two' } });

    // Two thumbnails already say "two"; a "2 works" caption beside them is the
    // chip reading itself out loud.
    await waitFor(() =>
      expect(container.querySelectorAll('p.flex.flex-wrap img')).toHaveLength(2)
    );
    expect(screen.queryByText('2 works')).not.toBeInTheDocument();
    // But the fact survives for anyone who cannot see the pictures.
    expect(container.querySelector('.sr-only')).toHaveTextContent(
      /Salt Marsh, Lake George/
    );
  });

  it('surfaces a message when microphone permission is denied', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    hold();
    act(() => {
      recogniser().onerror?.({ error: 'not-allowed' });
    });

    await screen.findByRole('alert');
    expect(
      screen.getByText(/Microphone access was denied/i)
    ).toBeInTheDocument();
  });

  it('surfaces a message when no speech was heard', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    hold();
    act(() => {
      recogniser().onerror?.({ error: 'no-speech' });
    });

    await screen.findByRole('alert');
    expect(screen.getByText(/No speech was heard/i)).toBeInTheDocument();
  });

  it('says nothing about a stop the human asked for', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    hold();
    act(() => {
      recogniser().onerror?.({ error: 'aborted' });
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
