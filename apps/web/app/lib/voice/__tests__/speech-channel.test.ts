import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSpeechChannel,
  firstSentence,
  shouldSpeakReply,
} from '../speech-channel';

type FakeUtterance = { text: string; rate: number };

const installSynthesis = (over: Partial<SpeechSynthesis> = {}) => {
  const spoken: FakeUtterance[] = [];
  const synthesis = {
    speaking: false,
    pending: false,
    speak: vi.fn((utterance: FakeUtterance) => {
      spoken.push(utterance);
    }),
    cancel: vi.fn(),
    ...over,
  };
  vi.stubGlobal('speechSynthesis', synthesis);
  (window as unknown as { speechSynthesis: unknown }).speechSynthesis = synthesis;
  (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
    function (this: FakeUtterance, text: string) {
      this.text = text;
      this.rate = 1;
    };
  return { synthesis, spoken };
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  delete (window as unknown as { SpeechSynthesisUtterance?: unknown })
    .SpeechSynthesisUtterance;
});

describe('shouldSpeakReply', () => {
  it('speaks after a spoken turn and stays quiet after a typed one', () => {
    expect(shouldSpeakReply('voice')).toBe(true);
    expect(shouldSpeakReply('text')).toBe(false);
    expect(shouldSpeakReply(null)).toBe(false);
  });
});

describe('firstSentence', () => {
  it('takes one sentence and leaves the rest to the board', () => {
    expect(
      firstSentence(
        'Five warm, calm options. I dropped the two with figures in them. Say the word and I will widen it.'
      )
    ).toBe('Five warm, calm options.');
  });

  it('keeps a single unpunctuated sentence whole', () => {
    expect(firstSentence('Five warm options for above the sofa')).toBe(
      'Five warm options for above the sofa'
    );
  });

  it('collapses the whitespace a model likes to leave in', () => {
    expect(firstSentence('  Five warm\n  options.  ')).toBe(
      'Five warm options.'
    );
  });

  it('clips a runaway sentence at a word boundary', () => {
    const clipped = firstSentence('word '.repeat(80), 40);
    expect(clipped.length).toBeLessThanOrEqual(41);
    expect(clipped.endsWith('…')).toBe(true);
    expect(clipped).not.toMatch(/wor…$/);
  });

  it('is empty for an empty note', () => {
    expect(firstSentence('   ')).toBe('');
  });
});

describe('createSpeechChannel', () => {
  it('is null where the browser cannot speak', () => {
    expect(createSpeechChannel()).toBeNull();
  });

  it('speaks one sentence of the note', () => {
    const { spoken } = installSynthesis();
    createSpeechChannel()?.speak('Five warm options. And more besides.');
    expect(spoken.map((utterance) => utterance.text)).toEqual([
      'Five warm options.',
    ]);
  });

  it('will not talk over a caption read-aloud somebody asked for', () => {
    const { spoken } = installSynthesis({ speaking: true });
    createSpeechChannel()?.speak('Five warm options.');
    expect(spoken).toEqual([]);
  });

  it('cancels its own speech but not a silence it does not own', () => {
    const { synthesis } = installSynthesis();
    const channel = createSpeechChannel();

    channel?.cancel();
    expect(synthesis.cancel).not.toHaveBeenCalled();

    channel?.speak('Five warm options.');
    channel?.cancel();
    expect(synthesis.cancel).toHaveBeenCalledTimes(1);
  });

  it('replaces its own previous note rather than queueing behind it', () => {
    const { synthesis, spoken } = installSynthesis();
    const channel = createSpeechChannel();
    channel?.speak('First note.');
    channel?.speak('Second note.');
    expect(synthesis.cancel).toHaveBeenCalled();
    expect(spoken.map((utterance) => utterance.text)).toEqual([
      'First note.',
      'Second note.',
    ]);
  });

  it('says nothing for an empty note', () => {
    const { synthesis } = installSynthesis();
    createSpeechChannel()?.speak('');
    expect(synthesis.speak).not.toHaveBeenCalled();
  });
});
