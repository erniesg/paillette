/**
 * The one line each tool call gets in the log.
 *
 * The culling tools — `flag_artworks`, `redeal`, `compare_artworks` — landed
 * after this module was written, so every one of them summarised as "done": a
 * row saying that a redeal happened and nothing about what it did. The shapes
 * asserted here were read off the real tools running in a browser, not off the
 * type declarations.
 */

import { describe, expect, it } from 'vitest';
import { summariseToolResult } from '../summarise';

describe('summariseToolResult', () => {
  it('counts a search', () => {
    expect(
      summariseToolResult('search_artworks', { ok: true, count: 12, results: [] })
    ).toBe('12 results');
  });

  it('says what a redeal actually moved', () => {
    expect(
      summariseToolResult('redeal', {
        ok: true,
        kept: [{ id: 'a' }],
        removed: [{ id: 'b' }],
        added: [{ id: 'c' }, { id: 'd' }],
        order: ['a', 'c', 'd'],
        strategy: 'tighten',
      })
    ).toBe('dealt 3 · 2 new · 1 held · tighten');
  });

  it('separates picks from rejects, and marks an agent proposal as one', () => {
    expect(
      summariseToolResult('flag_artworks', {
        ok: true,
        applied: [
          { artworkId: 'a', flag: 'pick' },
          { artworkId: 'b', flag: 'reject' },
          { artworkId: 'c', flag: 'reject' },
        ],
        provisional: true,
      })
    ).toBe('1 picked · 2 rejected · provisional');
  });

  it('names the layout the agent chose', () => {
    expect(summariseToolResult('set_view', { ok: true, view: 'salon' })).toBe(
      'view salon'
    );
  });

  it('gives a caption rather than a measurement of one', () => {
    expect(
      summariseToolResult('describe_artwork', {
        ok: true,
        caption: 'A low grey horizon under cloud.',
      })
    ).toBe('“A low grey horizon under cloud.”');
  });

  it('clips a long caption', () => {
    const summary = summariseToolResult('describe_artwork', {
      ok: true,
      caption: 'z'.repeat(200),
    });
    expect(summary.length).toBeLessThanOrEqual(66);
    expect(summary.endsWith('…”')).toBe(true);
  });

  it('reports the two-up', () => {
    expect(
      summariseToolResult('compare_artworks', {
        ok: true,
        comparing: [{ id: 'a' }, { id: 'b' }],
      })
    ).toBe('two-up · 2 works');
  });

  it('reads a refusal as the code and the message', () => {
    expect(
      summariseToolResult('redeal', {
        ok: false,
        error: {
          code: 'NO_EXEMPLARS',
          message: 'Nothing has been picked yet.',
        },
      })
    ).toBe('NO_EXEMPLARS: Nothing has been picked yet.');
  });

  it('falls back rather than inventing something', () => {
    expect(summariseToolResult('set_results', { ok: true })).toBe('done');
    expect(summariseToolResult('anything', null)).toBe('done');
  });
});
