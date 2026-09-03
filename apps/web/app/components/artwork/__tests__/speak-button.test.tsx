import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpeakButton } from '../speak-button';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * `describe_artwork` generates the words; this component is what gets them to
 * someone who cannot see the painting. It has to disappear silently where the
 * API is missing rather than render a button that throws on click.
 */
describe('SpeakButton', () => {
  const stubSpeech = () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak, cancel });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        text: string;
        rate = 1;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(text: string) {
          this.text = text;
        }
      }
    );
    return { speak, cancel };
  };

  it('renders nothing when the browser has no speech synthesis', () => {
    const { container } = render(<SpeakButton text="A calm harbour." />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there is no description to read', () => {
    stubSpeech();
    const { container } = render(<SpeakButton text="   " />);
    expect(container).toBeEmptyDOMElement();
  });

  it('speaks the description, and cancels first so runs cannot stack', async () => {
    const { speak, cancel } = stubSpeech();
    render(<SpeakButton text="A calm harbour under a bruised sky." />);

    await userEvent.click(
      await screen.findByRole('button', { name: /read aloud/i })
    );

    expect(cancel).toHaveBeenCalled();
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0]![0].text).toBe(
      'A calm harbour under a bruised sky.'
    );
    // Mid-utterance the control has to become a way to stop it.
    expect(screen.getByRole('button', { name: /stop reading/i })).toBeTruthy();
  });
});
