/**
 * What the exhibition loader hands the room about size.
 *
 * The loader does not parse; it chooses which field to pass on. That choice
 * is where the NGA sizes were lost on the way to the wall: an all-null
 * structured object counted as "present", so nothing behind it was ever read.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildExhibitionPage } from '../exhibition-page.server';
import { parseDimensions } from '~/lib/room/dimensions';

const env = { APP_ENV: 'staging', PAILLETTE_API_URL: 'https://api.example' };

const EMPTY = { height: null, width: null, depth: null, unit: null };

const records: Record<string, Record<string, unknown>> = {
  // After the backfill: the columns, as the API returns them.
  measured: {
    dimensions: { height: 62.5, width: 96.8, depth: null, unit: 'cm' },
    custom_metadata: { dimensions_text: 'overall: 62.5 x 96.8 cm (24 5/8 x 38 1/8 in.)' },
  },
  // Columns empty, text kept: a record applied before the columns were filled.
  textOnly: {
    dimensions: EMPTY,
    custom_metadata: { dimensions_text: 'sheet: 32.1 × 24.6 cm (12 5/8 × 9 11/16 in.)' },
  },
  // The catalogue gave a diameter: the text is kept, and nothing parses.
  unparsed: {
    dimensions: EMPTY,
    custom_metadata: { dimensions_text: 'overall (diameter): 30.5 cm (12 in.)' },
  },
  // Half a size must reach the room as half a size, so the room refuses it.
  half: {
    dimensions: { height: 62.5, width: null, depth: null, unit: 'cm' },
    custom_metadata: { dimensions_text: 'overall: 62.5 x 96.8 cm' },
  },
  nothing: { dimensions: EMPTY, custom_metadata: {} },
};

const api = vi.fn((input: RequestInfo | URL) => {
  const id = String(input).split('/artworks/')[1] ?? '';
  return Promise.resolve(
    Response.json({
      success: true,
      data: { id, title: id, ...records[id] },
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const hang = async () => {
  vi.stubGlobal('fetch', api);
  const page = await buildExhibitionPage({
    payload: {
      collectionId: 'nga',
      title: 'Sizes',
      titleByAgent: false,
      statement: null,
      statementByAgent: false,
      works: Object.keys(records).map((artworkId) => ({
        artworkId,
        label: null,
        labelByAgent: false,
      })),
    },
    env,
    canonicalUrl: 'https://paillette.test/e/aB3xk9m',
  });
  return Object.fromEntries(page!.works.map((work) => [work.artworkId, work.dimensions]));
};

describe('buildExhibitionPage dimensions', () => {
  it('passes the measured columns through as they are', async () => {
    const dimensions = await hang();
    expect(dimensions.measured).toEqual({ height: 62.5, width: 96.8, depth: null, unit: 'cm' });
    expect(parseDimensions(dimensions.measured)).toEqual({ heightCm: 62.5, widthCm: 96.8 });
  });

  it('reaches the catalogue text when the columns are empty', async () => {
    const dimensions = await hang();
    expect(dimensions.textOnly).toBe('sheet: 32.1 × 24.6 cm (12 5/8 × 9 11/16 in.)');
    expect(parseDimensions(dimensions.textOnly)).toEqual({ heightCm: 32.1, widthCm: 24.6 });
  });

  it('carries unparseable text on, and the room hangs the default', async () => {
    const dimensions = await hang();
    expect(dimensions.unparsed).toBe('overall (diameter): 30.5 cm (12 in.)');
    expect(parseDimensions(dimensions.unparsed)).toBeNull();
  });

  it('never completes a half size from the text', async () => {
    const dimensions = await hang();
    expect(dimensions.half).toEqual({ height: 62.5, width: null, depth: null, unit: 'cm' });
    expect(parseDimensions(dimensions.half)).toBeNull();
  });

  it('is null when the record says nothing about size', async () => {
    const dimensions = await hang();
    expect(dimensions.nothing).toBeNull();
  });
});
