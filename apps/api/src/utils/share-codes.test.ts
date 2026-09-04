/**
 * The code, before it is ever a query.
 *
 * Two properties matter and neither is "it looks random". First: a code that a
 * human mistyped must be *rejected*, not resolved to a different exhibition —
 * an `O` for a `0` should give them a 404 rather than a stranger's show.
 * Second: the alphabet has to be uniform, because a generator that leans on
 * the first sixteen characters shrinks the keyspace it advertises.
 */

import { describe, expect, it } from 'vitest';
import {
  SHARE_CODE_ALPHABET,
  SHARE_CODE_LENGTH,
  generateShareCode,
  isShareCode,
  normaliseShareCode,
  readShareCode,
  shareCodePath,
} from '@paillette/types/share-codes';

describe('the alphabet', () => {
  it('drops every glyph that can be read as another one', () => {
    for (const glyph of ['0', 'O', '1', 'l', 'I']) {
      expect(SHARE_CODE_ALPHABET).not.toContain(glyph);
    }
  });

  it('is base62 minus exactly those five', () => {
    expect(SHARE_CODE_ALPHABET).toHaveLength(57);
    expect(new Set(SHARE_CODE_ALPHABET).size).toBe(57);
  });
});

describe('generation', () => {
  it('is the documented length and stays inside the alphabet', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const code = generateShareCode();
      expect(code).toHaveLength(SHARE_CODE_LENGTH);
      expect(isShareCode(code)).toBe(true);
    }
  });

  it('does not collide across a run that would notice', () => {
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 5000; attempt += 1) seen.add(generateShareCode());
    expect(seen.size).toBe(5000);
  });

  /*
   * Rejection sampling is the whole reason `generateShareCode` is not three
   * lines. A modulo over 256 would make the first 28 characters of a 57-letter
   * alphabet come up 5/4 as often as the rest, and nothing else in the suite
   * would ever notice. 57 buckets over 60k draws puts the expected count near
   * 1050; a biased generator lands the two halves either side of that by a
   * margin this window will not tolerate.
   */
  it('spreads evenly over the alphabet rather than favouring the low bytes', () => {
    const counts = new Map<string, number>();
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      for (const character of generateShareCode()) {
        counts.set(character, (counts.get(character) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(SHARE_CODE_ALPHABET.length);
    const expected = (10_000 * SHARE_CODE_LENGTH) / SHARE_CODE_ALPHABET.length;
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(expected * 0.8);
      expect(count).toBeLessThan(expected * 1.2);
    }
  });
});

describe('normalisation', () => {
  it('trims, and strips what a chat client wraps a link in', () => {
    const code = generateShareCode();
    expect(normaliseShareCode(`  ${code}  `)).toBe(code);
    expect(normaliseShareCode(`<${code}>`)).toBe(code);
    expect(normaliseShareCode(`${code}.`)).toBe(code);
    expect(normaliseShareCode(`"${code}",`)).toBe(code);
  });

  /*
   * The first draft of this "repaired" ambiguous glyphs — mapped a typed `O`
   * back onto its intended neighbour. That is wrong here in a way worth
   * keeping a test for: only `0 O 1 l I` were dropped, so lowercase `o` and
   * `i` are perfectly valid characters, and the repair would have quietly
   * handed the visitor a *different, real* exhibition. Refusal is the feature.
   */
  it('refuses a mistyped glyph rather than resolving it to another show', () => {
    expect(isShareCode('abcdefg')).toBe(true);
    for (const bad of ['abcdef0', 'abcdefO', 'abcdef1', 'abcdefl', 'abcdefI']) {
      expect(readShareCode(bad)).toBeNull();
    }
    // The two that survived the cull stay valid, which is what makes the above
    // a real risk rather than a theoretical one.
    expect(isShareCode('abcdefo')).toBe(true);
    expect(isShareCode('abcdefi')).toBe(true);
  });

  it('refuses an over-long code instead of clipping it into a valid one', () => {
    // `abcdefghi` clipped to eight is `abcdefgh` — valid, and somebody else's.
    expect(isShareCode('abcdefgh')).toBe(true);
    expect(readShareCode('abcdefghi')).toBeNull();
  });

  it('does not case-fold, because the alphabet is mixed case', () => {
    expect(readShareCode('aB3xk9m')).toBe('aB3xk9m');
    expect(readShareCode('Ab3Xk9M')).toBe('Ab3Xk9M');
    expect(readShareCode('aB3xk9m')).not.toBe(readShareCode('Ab3Xk9M'));
  });

  it('says no to everything that is not a code', () => {
    for (const bad of [
      '',
      '   ',
      'abcdef', // six — too short
      'abcde-f',
      'abcde/f',
      '../../etc',
      "abc' OR 1=1",
      null,
      undefined,
    ]) {
      expect(readShareCode(bad as string)).toBeNull();
    }
  });

  it('accepts eight, because the length may grow without breaking old links', () => {
    expect(isShareCode(generateShareCode(8))).toBe(true);
  });
});

describe('the path', () => {
  it('is the short one', () => {
    expect(shareCodePath('aB3xk9m')).toBe('/e/aB3xk9m');
  });
});
