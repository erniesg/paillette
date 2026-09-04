/**
 * The log renders whatever a tool returned, and a tool can return anything.
 *
 * These are the cases that would otherwise take the panel down with them: a
 * cycle, a base64 image, a thousand-element array, a BigInt.
 */

import { describe, expect, it } from 'vitest';
import {
  detailJson,
  formatDuration,
  inlineJson,
  previewJson,
  shapedError,
} from '../activity-format';

describe('inlineJson', () => {
  it('shows arguments as arguments, not as a sentence', () => {
    expect(inlineJson({ query: 'storm at sea', topK: 12 })).toBe(
      '{"query":"storm at sea","topK":12}'
    );
  });

  it('clips a long line rather than wrapping the row', () => {
    const line = inlineJson({ note: 'x'.repeat(400) });
    expect(line.length).toBeLessThanOrEqual(96);
    expect(line.endsWith('…')).toBe(true);
  });

  it('has something to say about no arguments at all', () => {
    expect(inlineJson(undefined)).toBe('{}');
    expect(inlineJson({})).toBe('{}');
  });
});

describe('previewJson', () => {
  it('keeps the shape of the result, indented', () => {
    expect(previewJson({ ok: true, count: 2 })).toBe(
      '{\n  "ok": true,\n  "count": 2\n}'
    );
  });

  it('survives a cycle instead of losing the entry', () => {
    const cyclic: Record<string, unknown> = { name: 'board' };
    cyclic.self = cyclic;
    expect(previewJson(cyclic)).toContain('[circular]');
  });

  it('names how much of a long array it cut', () => {
    const preview = previewJson({ ids: Array.from({ length: 40 }, (_, i) => i) });
    expect(preview).toContain('… 28 more');
  });

  it('will not paste a base64 image into the panel', () => {
    const preview = previewJson({ dataUrl: `data:image/png;base64,${'A'.repeat(9_000)}` })!;
    expect(preview.length).toBeLessThan(600);
  });

  it('handles values JSON has no opinion about', () => {
    expect(previewJson({ n: 10n, f: () => null })).toContain('"10n"');
    expect(previewJson(undefined)).toBeNull();
  });

  it('caps the whole payload', () => {
    const big = { works: Array.from({ length: 12 }, () => ({ blurb: 'y'.repeat(230) })) };
    expect(previewJson(big)!.length).toBeLessThanOrEqual(2_500);
  });
});

describe('detailJson', () => {
  it('pretty-prints the arguments for the expanded row', () => {
    expect(detailJson({ positiveIds: ['a'] })).toBe(
      '{\n  "positiveIds": [\n    "a"\n  ]\n}'
    );
  });
});

describe('shapedError', () => {
  it('reads a refusal the tool returned rather than threw', () => {
    expect(
      shapedError({
        ok: false,
        error: { code: 'REDEAL_IN_FLIGHT', message: 'a deal is already running' },
      })
    ).toBe('REDEAL_IN_FLIGHT: a deal is already running');
  });

  it('copes with half a refusal', () => {
    expect(shapedError({ ok: false, error: { message: 'no' } })).toBe('no');
    expect(shapedError({ ok: false })).toBe('failed');
  });

  it('says nothing about a result that worked', () => {
    expect(shapedError({ ok: true, count: 3 })).toBeNull();
    expect(shapedError({ count: 3 })).toBeNull();
    expect(shapedError(null)).toBeNull();
    expect(shapedError('done')).toBeNull();
  });
});

describe('formatDuration', () => {
  it('is exact where exactness is readable and rounds where it is not', () => {
    expect(formatDuration(142)).toBe('142ms');
    expect(formatDuration(999)).toBe('999ms');
    expect(formatDuration(4_512)).toBe('4.5s');
    expect(formatDuration(64_000)).toBe('64s');
  });
});
