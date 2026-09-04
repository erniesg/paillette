import { afterEach, describe, expect, it } from 'vitest';
import {
  getSpeechRecognition,
  isQuietRecognitionError,
  readTranscripts,
  voiceErrorMessage,
} from '../recognition';

const result = (transcript: string, isFinal: boolean) =>
  Object.assign([{ transcript }], { isFinal });

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown })
    .webkitSpeechRecognition;
});

describe('getSpeechRecognition', () => {
  it('is null where the browser has no recogniser', () => {
    expect(getSpeechRecognition()).toBeNull();
  });

  it('accepts the prefixed constructor Chrome ships', () => {
    const Recognition = function () {};
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition =
      Recognition;
    expect(getSpeechRecognition()).toBe(Recognition);
  });

  it('prefers the unprefixed constructor when both exist', () => {
    const standard = function () {};
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition =
      standard;
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition =
      function () {};
    expect(getSpeechRecognition()).toBe(standard);
  });
});

describe('readTranscripts', () => {
  it('separates what has settled from what is still moving', () => {
    expect(
      readTranscripts({
        results: [
          result('something warm ', true),
          result('for above the sof', false),
        ],
      })
    ).toEqual({ final: 'something warm', interim: 'for above the sof' });
  });

  it('rebuilds both halves from the whole list each time', () => {
    // The recogniser re-sends every result on every event; accumulating would
    // duplicate the settled words.
    expect(
      readTranscripts({
        results: [result('warm ', true), result('and quiet', true)],
      })
    ).toEqual({ final: 'warm and quiet', interim: '' });
  });

  it('survives a sparse or empty result list', () => {
    expect(readTranscripts({ results: [] })).toEqual({ final: '', interim: '' });
    expect(
      readTranscripts({ results: [undefined as never, result('warm', false)] })
    ).toEqual({ final: '', interim: 'warm' });
  });
});

describe('voiceErrorMessage', () => {
  it('tells someone what to do about a refused microphone', () => {
    expect(voiceErrorMessage('not-allowed')).toMatch(/Allow it in your browser/);
    expect(voiceErrorMessage('no-speech')).toMatch(/No speech was heard/);
    expect(voiceErrorMessage('network')).toMatch(/Voice input stopped/);
  });
});

describe('isQuietRecognitionError', () => {
  it('swallows only the stop the human asked for', () => {
    expect(isQuietRecognitionError('aborted')).toBe(true);
    expect(isQuietRecognitionError('no-speech')).toBe(false);
    expect(isQuietRecognitionError('not-allowed')).toBe(false);
  });
});
