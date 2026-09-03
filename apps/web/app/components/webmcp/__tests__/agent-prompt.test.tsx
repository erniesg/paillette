import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentPrompt } from '../agent-prompt';
import { GRACE_MS } from '~/lib/voice/utterance';

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

const installRecognition = () => {
  recognitionInstance = null;
  const Recognition = function (this: RecognitionInstance) {
    this.lang = '';
    this.interimResults = false;
    this.continuous = false;
    this.onresult = null;
    this.onend = null;
    this.onerror = null;
    this.start = vi.fn();
    this.stop = vi.fn();
    recognitionInstance = this;
  };
  (
    window as unknown as { webkitSpeechRecognition?: unknown }
  ).webkitSpeechRecognition = Recognition;
};

const setModelContext = (value: unknown) => {
  (document as { modelContext?: unknown }).modelContext = value;
};

const stubFetch = () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      success: true,
      data: { message: { role: 'assistant', content: '' } },
    }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const alternative = (transcript: string) => [{ transcript }];
const said = (transcript: string, isFinal: boolean) =>
  Object.assign(alternative(transcript), { isFinal });

const recogniser = () => recognitionInstance as unknown as RecognitionInstance;

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
    expect(screen.getByText(/Enter to send, Esc to discard/)).toBeInTheDocument();
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
