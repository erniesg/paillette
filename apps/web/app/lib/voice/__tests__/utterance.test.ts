import { describe, expect, it } from 'vitest';
import {
  GRACE_MS,
  composeUtterance,
  graceProgress,
  interimOffset,
  settleUtterance,
} from '../utterance';

describe('composeUtterance', () => {
  it('is the spoken words alone when nothing was typed', () => {
    expect(composeUtterance('', 'something warm')).toBe('something warm');
  });

  it('extends typed text rather than replacing it', () => {
    expect(composeUtterance('warm landscape', 'without people')).toBe(
      'warm landscape without people'
    );
  });

  it('does not double a space the human already typed', () => {
    expect(composeUtterance('warm ', 'skies')).toBe('warm skies');
  });

  it('does not push punctuation away from the word it belongs to', () => {
    expect(composeUtterance('warm', ', not busy')).toBe('warm, not busy');
  });

  it('leaves the typed text alone while nothing is being heard', () => {
    expect(composeUtterance('warm landscape', '')).toBe('warm landscape');
  });
});

describe('interimOffset', () => {
  it('marks where the provisional half of the field begins', () => {
    const committed = 'warm landscape';
    const interim = 'without people';
    const composed = composeUtterance(committed, interim);
    expect(composed.slice(interimOffset(committed, interim))).toBe(interim);
  });

  it('is the end of the string when nothing is being heard', () => {
    expect(interimOffset('warm', '')).toBe(4);
  });
});

describe('settleUtterance', () => {
  it('prefers the settled transcript', () => {
    expect(settleUtterance('warm', 'and quiet', 'and qui')).toBe(
      'warm and quiet'
    );
  });

  it('keeps the interim words when the recogniser never settles', () => {
    // A short push-to-talk press can end with only interim results, and the
    // human watched those words appear.
    expect(settleUtterance('warm', '', 'and quiet')).toBe('warm and quiet');
  });
});

describe('graceProgress', () => {
  it('starts empty and ends full', () => {
    expect(graceProgress(1000, 1000)).toBe(0);
    expect(graceProgress(1000, 1000 + GRACE_MS)).toBe(1);
  });

  it('is halfway at half the grace', () => {
    expect(graceProgress(1000, 1000 + GRACE_MS / 2)).toBeCloseTo(0.5);
  });

  it('never overruns, so the bar cannot draw past the field', () => {
    expect(graceProgress(1000, 99999)).toBe(1);
    expect(graceProgress(1000, 500)).toBe(0);
  });
});
