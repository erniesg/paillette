/**
 * The shareable exhibition page, opened cold.
 *
 * There is no session here and there is nothing in memory: the visitor has
 * never used Paillette, the ids in the link mean nothing to their browser, and
 * every catalogue fact on the page has to be re-fetched by id on the server
 * before a pixel is sent. That is the whole test.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { loader } from '../exhibition';
import {
  encodeExhibitionLink,
  exhibitionLinkPath,
  type ExhibitionLinkPayload,
} from '~/lib/exhibition-link';

const record = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Work ${id}`,
  artist: 'Fitz Henry Lane',
  year: 1863,
  date_text: '1863',
  medium: 'oil on canvas',
  classification: 'Painting',
  accession_number: '1998.1.1',
  source_url: 'https://www.nga.gov/collection/art-object-page.145236.html',
  image_url: 'https://assets.paillette.test/api/v1/assets/x/content',
  provenance: JSON.stringify({
    source_image_url:
      'https://api.nga.gov/iiif/abc/full/full/0/default.jpg',
  }),
  ...overrides,
});

const stubCatalogue = (
  rows: Record<string, Record<string, unknown> | null>
) => {
  const seen: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      const id = url.split('/artworks/')[1] ?? '';
      const row = rows[decodeURIComponent(id)];
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

const show = (
  overrides: Partial<ExhibitionLinkPayload> = {}
): ExhibitionLinkPayload => ({
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
});

const run = async (search: string): Promise<any> =>
  loader({
    context: {},
    params: {},
    request: new Request(`https://paillette.test/exhibition${search}`),
  } as any);

const open = async (payload: ExhibitionLinkPayload) =>
  run(exhibitionLinkPath(await encodeExhibitionLink(payload)).slice('/exhibition'.length));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('opened cold', () => {
  it('re-fetches every work by id and renders the show in order', async () => {
    const seen = stubCatalogue({ a: record('a'), b: record('b') });
    const page = await (await open(show())).json();

    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain('/orgs/nga/artworks/a');
    expect(page.title).toBe('Everything the Light Left Behind');
    expect(page.statement).toBe('It is not about weather. It is about leaving.');
    expect(page.statementByAgent).toBe(false);
    expect(page.works.map((work: any) => work.artworkId)).toEqual(['a', 'b']);
    expect(page.works[0]).toMatchObject({
      title: 'Work a',
      artist: 'Fitz Henry Lane',
      date: '1863',
      medium: 'oil on canvas',
      accession: '1998.1.1',
      label: 'The boat is already gone.',
      labelByAgent: true,
    });
    expect(page.missing).toBe(0);
  });

  it('uses the institution’s public image, not Paillette’s gated asset URL', async () => {
    stubCatalogue({ a: record('a'), b: record('b') });
    const page = await (await open(show())).json();
    // A session-gated asset URL renders as a broken image for exactly the
    // visitor this page exists for.
    expect(page.works[0]?.imageUrl).toBe(
      'https://api.nga.gov/iiif/abc/full/full/0/default.jpg'
    );
  });

  it('falls back to image_url when there is no provenance blob', async () => {
    stubCatalogue({
      a: record('a', {
        provenance: null,
        image_url: 'https://images.example/a.jpg',
      }),
      b: record('b'),
    });
    const page = await (await open(show())).json();
    expect(page.works[0]?.imageUrl).toBe('https://images.example/a.jpg');
  });

  it('keeps the show when one work cannot be resolved, and says how many', async () => {
    stubCatalogue({ a: record('a'), b: null });
    const page = await (await open(show())).json();
    expect(page.works).toHaveLength(1);
    expect(page.missing).toBe(1);
  });

  it('survives the catalogue throwing rather than answering', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/a')) throw new Error('connection reset');
        return Response.json({ success: true, data: record('b') });
      })
    );
    const page = await (await open(show())).json();
    expect(page.works.map((work: any) => work.artworkId)).toEqual(['b']);
    expect(page.missing).toBe(1);
  });

  it('credits the collection and its rights without being asked', async () => {
    stubCatalogue({ a: record('a'), b: record('b') });
    const page = await (await open(show())).json();
    expect(page.institution).toBe('National Gallery of Art, Washington');
    expect(page.rights).toContain('public domain');
  });

  it('is cacheable, because the link is the record', async () => {
    stubCatalogue({ a: record('a'), b: record('b') });
    const response = await open(show());
    expect(response.headers.get('Cache-Control')).toContain('s-maxage');
  });
});

describe('a link that is not one', () => {
  it('404s with no parameter', async () => {
    await expect(run('')).rejects.toMatchObject({ status: 404 });
  });

  it('404s on a payload it cannot read', async () => {
    await expect(run('?e=nonsense')).rejects.toMatchObject({ status: 404 });
  });

  it('404s on a collection this route does not serve', async () => {
    const encoded = await encodeExhibitionLink(
      show({ collectionId: 'somebody-elses' })
    );
    await expect(run(`?e=${encoded}`)).rejects.toMatchObject({ status: 404 });
  });

  it('404s rather than rendering an empty room', async () => {
    stubCatalogue({});
    await expect(open(show())).rejects.toMatchObject({ status: 404 });
  });
});
