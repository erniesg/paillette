/**
 * `/e/:code`, opened cold.
 *
 * Same test as the long link's, from the other end. There is no session, the
 * code carries no content, and the visitor has never used Paillette — so the
 * API has to supply the prose and the catalogue has to supply every record,
 * both on the server, before a pixel is sent.
 *
 * The one thing this route has that the long link does not is a lookup that
 * can fail four different ways, and all four have to be the same 404. A short
 * link is guessable in a way a 1,900-character payload is not, so the failures
 * must not be distinguishable enough to tell an enumerator anything.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { loader } from '../e.$code';

const CODE = 'aB3xk9m';

const exhibition = (overrides: Record<string, unknown> = {}) => ({
  success: true,
  data: {
    collectionId: 'nga',
    title: 'Everything the Light Left Behind',
    titleByAgent: true,
    statement: 'It is not about weather. It is about leaving.',
    statementByAgent: false,
    works: [
      { artworkId: 'a', label: 'The boat is already gone.', labelByAgent: true },
      { artworkId: 'b', label: 'Mine.', labelByAgent: false },
    ],
    ...overrides,
  },
});

const record = (id: string) => ({
  id,
  title: `Work ${id}`,
  artist: 'Fitz Henry Lane',
  year: 1863,
  date_text: '1863',
  medium: 'oil on canvas',
  accession_number: '1998.1.1',
  source_url: 'https://www.nga.gov/collection/art-object-page.145236.html',
  provenance: JSON.stringify({
    source_image_url: 'https://api.nga.gov/iiif/abc/full/full/0/default.jpg',
  }),
});

const stub = ({
  show = exhibition(),
  showStatus = 200,
  rows = { a: record('a'), b: record('b') } as Record<string, unknown>,
}: {
  show?: unknown;
  showStatus?: number;
  rows?: Record<string, unknown>;
} = {}) => {
  const seen: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      if (url.includes('/public-exhibitions/')) {
        return Response.json(show, { status: showStatus });
      }
      const id = decodeURIComponent(url.split('/artworks/')[1] ?? '');
      const row = rows[id];
      if (!row) {
        return Response.json(
          { success: false, error: { code: 'NOT_FOUND', message: 'no' } },
          { status: 404 }
        );
      }
      return Response.json({ success: true, data: row });
    })
  );
  return seen;
};

const run = async (code: string): Promise<any> =>
  loader({
    context: {},
    params: { code },
    request: new Request(`https://paillette.test/e/${code}`),
  } as any);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('opened cold', () => {
  it('resolves the code, then every work, and renders the show in order', async () => {
    const seen = stub();
    const page = await (await run(CODE)).json();

    expect(seen[0]).toContain(`/api/public-exhibitions/${CODE}`);
    expect(seen).toHaveLength(3);
    expect(page.title).toBe('Everything the Light Left Behind');
    expect(page.statement).toBe('It is not about weather. It is about leaving.');
    expect(page.works.map((work: any) => work.artworkId)).toEqual(['a', 'b']);
    expect(page.works[0]).toMatchObject({
      title: 'Work a',
      artist: 'Fitz Henry Lane',
      label: 'The boat is already gone.',
      labelByAgent: true,
    });
  });

  it('carries the code and a canonical URL for the head to point at', async () => {
    stub();
    const page = await (await run(CODE)).json();
    expect(page.code).toBe(CODE);
    expect(page.canonicalUrl).toBe(`https://paillette.test/e/${CODE}`);
  });

  it('uses the institution’s public image, not a gated asset URL', async () => {
    stub();
    const page = await (await run(CODE)).json();
    expect(page.works[0]?.imageUrl).toBe(
      'https://api.nga.gov/iiif/abc/full/full/0/default.jpg'
    );
  });

  it('keeps the show when one work cannot be resolved, and says how many', async () => {
    stub({ rows: { a: record('a') } });
    const page = await (await run(CODE)).json();
    expect(page.works).toHaveLength(1);
    expect(page.missing).toBe(1);
  });

  it('is cacheable, briefly — the row can be republished', async () => {
    stub();
    const response = await run(CODE);
    expect(response.headers.get('Cache-Control')).toContain('s-maxage');
  });
});

describe('a code that does not open', () => {
  it('404s on a code the API does not know', async () => {
    stub({ showStatus: 404, show: { success: false } });
    await expect(run(CODE)).rejects.toMatchObject({ status: 404 });
  });

  it('404s when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused');
      })
    );
    await expect(run(CODE)).rejects.toMatchObject({ status: 404 });
  });

  it('404s rather than rendering an empty room', async () => {
    stub({ rows: {} });
    await expect(run(CODE)).rejects.toMatchObject({ status: 404 });
  });

  it('404s on a collection this route does not serve', async () => {
    stub({ show: exhibition({ collectionId: 'somebody-elses' }) });
    await expect(run(CODE)).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    ['too short', 'abc'],
    ['too long', 'abcdefghij'],
    ['an ambiguous glyph', 'abcdef0'],
    ['a traversal attempt', '..'],
    ['an injection attempt', "a'OR'1"],
  ])('404s on %s without asking anyone', async (_name, code) => {
    const seen = stub();
    await expect(run(code)).rejects.toMatchObject({ status: 404 });
    // Validated before any lookup: a malformed code never reaches the API.
    expect(seen).toHaveLength(0);
  });
});
