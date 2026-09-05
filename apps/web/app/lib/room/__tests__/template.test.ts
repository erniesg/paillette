import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATE,
  readTemplate,
  stripTemplate,
  templateHref,
} from '~/lib/room/template';

describe('readTemplate', () => {
  /**
   * The requirement, stated as an assertion: a link opened cold lands on the
   * flat page. Everything else in the room is downstream of this staying true.
   */
  it('defaults to the flat page when nobody asked for anything', () => {
    expect(readTemplate(null)).toBe('page');
    expect(readTemplate(undefined)).toBe('page');
    expect(readTemplate('')).toBe('page');
    expect(DEFAULT_TEMPLATE).toBe('page');
  });

  it('opens the room when the link says room', () => {
    expect(readTemplate('room')).toBe('room');
  });

  it('falls back rather than failing on a mangled parameter', () => {
    expect(readTemplate('roo')).toBe('page');
    expect(readTemplate('ROOM')).toBe('page');
    expect(readTemplate('3d')).toBe('page');
  });
});

describe('templateHref', () => {
  it('survives the short link', () => {
    expect(templateHref('/e/MKwsxHy', 'room')).toBe('/e/MKwsxHy?v=room');
  });

  it('keeps the show when the show is in the query string', () => {
    const href = templateHref('/exhibition?e=abc123', 'room');
    expect(href).toBe('/exhibition?e=abc123&v=room');
  });

  it('spells the ordinary view with the ordinary address', () => {
    expect(templateHref('/e/MKwsxHy?v=room', 'page')).toBe('/e/MKwsxHy');
    expect(templateHref('/exhibition?e=abc&v=room', 'page')).toBe(
      '/exhibition?e=abc'
    );
  });

  it('does not accumulate a second parameter when asked twice', () => {
    expect(templateHref(templateHref('/e/abc', 'room'), 'room')).toBe(
      '/e/abc?v=room'
    );
  });
});

describe('stripTemplate', () => {
  it('keeps one canonical URL per show however it is being drawn', () => {
    expect(stripTemplate('https://x.test/exhibition?e=abc&v=room')).toBe(
      'https://x.test/exhibition?e=abc'
    );
  });

  it('leaves a URL it cannot parse alone', () => {
    expect(stripTemplate('not a url')).toBe('not a url');
  });
});
