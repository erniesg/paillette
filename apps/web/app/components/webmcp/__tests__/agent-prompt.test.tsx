import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentPrompt } from '../agent-prompt';

const PLACEHOLDER = 'Ask for what you want to see…';

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
    this.continuous = true;
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

afterEach(() => {
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
    expect(screen.queryByLabelText('Speak your request')).not.toBeInTheDocument();
  });

  it('hides the mic button when there is no speech recognition', async () => {
    setModelContext({ getTools: async () => [] });
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);
    expect(screen.queryByLabelText('Speak your request')).not.toBeInTheDocument();
  });

  it('writes an interim transcript into the input as it arrives', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    fireEvent.click(screen.getByLabelText('Speak your request'));

    const recognition = recognitionInstance as unknown as RecognitionInstance;
    expect(recognition.interimResults).toBe(true);
    expect(recognition.continuous).toBe(false);

    act(() => {
      recognition.onresult?.({
        results: [
          Object.assign(alternative('something warm'), { isFinal: false }),
        ],
      });
    });

    await waitFor(() =>
      expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveValue(
        'something warm'
      )
    );
  });

  it('submits on the final result and clears the input', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    const fetchMock = stubFetch();
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    fireEvent.click(screen.getByLabelText('Speak your request'));

    const recognition = recognitionInstance as unknown as RecognitionInstance;
    act(() => {
      recognition.onresult?.({
        results: [
          Object.assign(
            alternative('something warm for above the sofa'),
            { isFinal: true }
          ),
        ],
      });
    });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/public-agent/turn',
        expect.objectContaining({ method: 'POST' })
      )
    );
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveValue('');
    expect(
      screen.getByText('something warm for above the sofa')
    ).toBeInTheDocument();
  });

  it('draws words still being heard at a lower contrast than settled ones', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    const { container } = render(<AgentPrompt />);
    const field = await screen.findByPlaceholderText(PLACEHOLDER);

    fireEvent.change(field, { target: { value: 'warm landscape' } });
    fireEvent.click(screen.getByLabelText('Speak your request'));

    const recognition = recognitionInstance as unknown as RecognitionInstance;
    act(() => {
      recognition.onresult?.({
        results: [Object.assign(alternative('without people'), { isFinal: false })],
      });
    });

    // The typed half stays white; the heard half is grey until it settles.
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
    fireEvent.click(screen.getByLabelText('Speak your request'));

    const recognition = recognitionInstance as unknown as RecognitionInstance;
    act(() => {
      recognition.onresult?.({
        results: [Object.assign(alternative('without people'), { isFinal: false })],
      });
    });

    await waitFor(() =>
      expect(field).toHaveValue('warm landscape without people')
    );
  });

  it('lets typing take ownership of spoken words rather than losing them', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    render(<AgentPrompt />);
    const field = await screen.findByPlaceholderText(PLACEHOLDER);

    fireEvent.click(screen.getByLabelText('Speak your request'));
    const recognition = recognitionInstance as unknown as RecognitionInstance;
    act(() => {
      recognition.onresult?.({
        results: [Object.assign(alternative('any in us in here'), { isFinal: false })],
      });
    });
    await waitFor(() => expect(field).toHaveValue('any in us in here'));

    // Text is the ground truth: editing the transcript is just editing.
    fireEvent.change(field, { target: { value: 'Inness' } });
    expect(field).toHaveValue('Inness');
    expect(field).toHaveClass('text-white');
  });

  it('surfaces a message when microphone permission is denied', async () => {
    setModelContext({ getTools: async () => [] });
    installRecognition();
    render(<AgentPrompt />);
    await screen.findByPlaceholderText(PLACEHOLDER);

    fireEvent.click(screen.getByLabelText('Speak your request'));

    const recognition = recognitionInstance as unknown as RecognitionInstance;
    act(() => {
      recognition.onerror?.({ error: 'not-allowed' });
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

    fireEvent.click(screen.getByLabelText('Speak your request'));

    const recognition = recognitionInstance as unknown as RecognitionInstance;
    act(() => {
      recognition.onerror?.({ error: 'no-speech' });
    });

    await screen.findByRole('alert');
    expect(screen.getByText(/No speech was heard/i)).toBeInTheDocument();
  });
});
