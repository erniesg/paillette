import { describe, expect, it } from 'vitest';
import { FRAME_PARAM, FRAME_STYLES, frameHref, readFrame } from '~/lib/room/frame';

describe('readFrame', () => {
  it('defaults to the unframed hanging for a missing or unknown value', () => {
    expect(readFrame(null)).toBe('none');
    expect(readFrame(undefined)).toBe('none');
    expect(readFrame('walnut')).toBe('none');
  });

  it('accepts every published frame style', () => {
    for (const style of FRAME_STYLES) expect(readFrame(style)).toBe(style);
  });
});

describe('frameHref', () => {
  it('adds the selected frame without losing the exhibition query or hash', () => {
    expect(frameHref('/exhibition?e=abc#works', 'oak')).toBe(
      '/exhibition?e=abc&frame=oak#works'
    );
  });

  it('replaces an existing frame choice instead of accumulating choices', () => {
    expect(frameHref('/e/abc?frame=black&v=room', 'gilt')).toBe(
      '/e/abc?frame=gilt&v=room'
    );
  });

  it('returns the plain exhibition address for the default frame', () => {
    expect(frameHref('/e/abc?frame=white#room', 'none')).toBe('/e/abc#room');
    expect(FRAME_PARAM).toBe('frame');
  });
});
