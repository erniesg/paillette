import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetArtworkIndexForTest, rememberArtworks } from '../artwork-index';
import { __resetWebMcpStateForTest, getWebMcpState } from '../store';
import { __resetShortlistsForTest } from '../shortlists';
import { createPailletteTools, type ToolContext } from '../tools';
import type { WebMcpTool } from '../registry';
import type { ArtworkSearchResult } from '~/types';

const artwork = (
  id: string,
  overrides: Partial<ArtworkSearchResult> = {}
): ArtworkSearchResult => ({
  id,
  galleryId: 'eabbf000',
  orgId: 'eabbf000',
  title: `Work ${id}`,
  artist: 'A. Painter',
  year: 1888,
  imageUrl: `https://assets.example/${id}.jpg`,
  thumbnailUrl: `https://assets.example/${id}-thumb.jpg`,
  similarity: 0.7123456,
  metadata: {
    medium: 'etching in black',
    classification: 'Print',
    dateText: '1888',
    date_text: '1888',
    description: 'A stormy ocean at night.',
    creditLine: 'Gift of Someone',
    credit_line: 'Gift of Someone',
    accessionNumber: '1998.1.1',
    sourceUrl: 'https://www.nga.gov/collection/art-object-page.145236.html',
    sourceInstitution: 'National Gallery of Art',
    rights: 'Open access',
    openAccess: true,
    // The API really returns weighted objects here; `ArtworkMetadata` types
    // the field as string[]. `collectDominantColors` handles both encodings.
    dominantColors: [
      { color: '#E9D7BD', rgb: { r: 233, g: 215, b: 189 }, percentage: 77.8 },
      { color: '#4A473D', rgb: { r: 74, g: 71, b: 61 }, percentage: 13.7 },
    ] as unknown as string[],
  },
  ...overrides,
});

const navigate = vi.fn();
const context: ToolContext = {
  navigate,
  getPageContext: () => ({
    pathname: '/collections/nga/search',
    search: '?q=storm',
    collectionId: 'nga',
    query: 'storm',
    facet: null,
    colour: null,
  }),
};

let tools: Map<string, WebMcpTool>;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const call = (name: string, input: Record<string, unknown> = {}) => {
  const tool = tools.get(name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool.execute(input, {}) as Promise<Record<string, any>>;
};

beforeEach(() => {
  navigate.mockClear();
  __resetArtworkIndexForTest();
  __resetWebMcpStateForTest();
  __resetShortlistsForTest();
  tools = new Map(
    createPailletteTools(context).map((tool) => [tool.name, tool])
  );
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('tool surface', () => {
  it('registers the documented set with usable schemas', () => {
    expect([...tools.keys()]).toEqual([
      'list_collections',
      'search_artworks',
      'search_by_image',
      'search_by_color',
      'browse_collection',
      'lookup_artwork',
      'get_search_quota',
      'get_view_context',
      'set_results',
      'show_artwork',
      'create_collection',
      'add_to_collection',
    ]);

    for (const tool of tools.values()) {
      expect(tool.name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
      expect(tool.description.length).toBeGreaterThan(60);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(typeof tool.annotations?.readOnlyHint).toBe('boolean');
      // Every declared property must document itself.
      for (const [key, schema] of Object.entries(
        tool.inputSchema.properties ?? {}
      )) {
        expect(
          (schema as { description?: string }).description,
          `${tool.name}.${key} needs a description`
        ).toBeTruthy();
      }
    }
  });

  it('marks the seven read tools readOnly and the rest not', () => {
    const readOnly = [...tools.values()]
      .filter((tool) => tool.annotations?.readOnlyHint === true)
      .map((tool) => tool.name);
    expect(readOnly).toEqual([
      'list_collections',
      'search_artworks',
      'search_by_image',
      'search_by_color',
      'browse_collection',
      'lookup_artwork',
      'get_search_quota',
      'get_view_context',
    ]);
  });
});

describe('search_artworks', () => {
  it('posts to the public route and returns compact results', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          results: [artwork('a')],
          count: 1,
          queryTime: 42,
          quota: { limit: 1000, used: 2, remaining: 998 },
          interpretation: { parserVersion: 'nga-v7' },
        },
      })
    );

    const result = await call('search_artworks', {
      query: 'stormy sea',
      topK: 5,
      facet: 'artist',
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/public-search/nga/text');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      query: 'stormy sea',
      topK: 5,
      minScore: 0.2,
      facet: 'artist',
    });

    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(result.quota).toEqual({ limit: 1000, used: 2, remaining: 998 });
    expect(result.results[0]).toMatchObject({
      id: 'a',
      title: 'Work a',
      artist: 'A. Painter',
      dateText: '1888',
      classification: 'Print',
      similarity: 0.712,
      palette: ['#E9D7BD', '#4A473D'],
      sourceUrl: 'https://www.nga.gov/collection/art-object-page.145236.html',
    });
    // The 2KB description is not in the search projection.
    expect(result.results[0]).not.toHaveProperty('description');
    // Results must be JSON-serialisable, not live objects.
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('clamps topK and minScore to the route’s real limits', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { results: [], count: 0, queryTime: 1 },
      })
    );

    await call('search_artworks', { query: 'x', topK: 9999, minScore: 7 });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string
    );
    expect(body.topK).toBe(100);
    expect(body.minScore).toBe(1);
  });

  it('returns a structured error rather than throwing', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: {
            code: 'NGA_PUBLIC_SEARCH_QUOTA_EXHAUSTED',
            message: 'Quota spent.',
          },
        },
        429
      )
    );

    const result = await call('search_artworks', { query: 'x' });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('NGA_PUBLIC_SEARCH_QUOTA_EXHAUSTED');
    expect(result.error.hint).toContain('browse_collection');
  });

  it('rejects an empty query without calling the network', async () => {
    const result = await call('search_artworks', { query: '   ' });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('propagates an abort instead of swallowing it', async () => {
    vi.mocked(fetch).mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    );
    const tool = tools.get('search_artworks')!;
    await expect(
      tool.execute({ query: 'x' }, { signal: new AbortController().signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reports a non-JSON response as a distinct code', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('<!DOCTYPE html><html></html>', {
        status: 404,
        headers: { 'Content-Type': 'text/html' },
      })
    );
    const result = await call('search_artworks', { query: 'x' });
    expect(result.error.code).toBe('NON_JSON_RESPONSE');
  });
});

describe('search_by_color', () => {
  it('runs the colour’s search language and re-ranks by palette distance', async () => {
    const fetchMock = vi.mocked(fetch);
    const warm = artwork('warm', {
      metadata: {
        dominantColors: [
          { color: '#BF5631', percentage: 90 },
        ] as unknown as string[],
      },
    });
    const cool = artwork('cool', {
      metadata: {
        dominantColors: [
          { color: '#1A2F52', percentage: 90 },
        ] as unknown as string[],
      },
    });
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { results: [cool, warm], count: 2, queryTime: 10 },
      })
    );

    const result = await call('search_by_color', { color: 'rust', topK: 2 });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string
    );
    expect(body.query).toBe('rust red orange');
    expect(result.color).toEqual({
      input: 'Rust',
      hex: '#bf5631',
      swatch: 'rust',
    });
    // Palette re-rank must put the rust work first, despite API order.
    expect(result.results.map((r: { id: string }) => r.id)).toEqual([
      'warm',
      'cool',
    ]);
    expect(result.humanSearchUrl).toBe(
      '/collections/nga/search?colour=rust'
    );
  });

  it('accepts a raw hex and maps it to the page’s custom swatch form', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        success: true,
        data: { results: [], count: 0, queryTime: 1 },
      })
    );
    const result = await call('search_by_color', { color: '#1A2F52' });
    expect(result.color.swatch).toBe('custom:#1a2f52');
  });

  it('rejects a colour it cannot resolve', async () => {
    const result = await call('search_by_color', { color: 'ultraviolet' });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_COLOUR');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('lookup_artwork', () => {
  it('returns the full record for anything the page has loaded', async () => {
    rememberArtworks([artwork('a')]);
    const result = await call('lookup_artwork', { artworkId: 'a' });
    expect(result.ok).toBe(true);
    expect(result.artworks[0]).toMatchObject({
      id: 'a',
      description: 'A stormy ocean at night.',
      creditLine: 'Gift of Someone',
      accessionNumber: '1998.1.1',
      openAccess: true,
    });
    expect(result.artworks[0].dominantColors).toHaveLength(2);
  });

  it('is explicit about session scope when an id is unknown', async () => {
    const result = await call('lookup_artwork', { artworkId: 'missing' });
    expect(result.error.code).toBe('ARTWORK_NOT_IN_SESSION');
    expect(result.error.hint).toContain('search_artworks');
  });

  it('reports partial resolution rather than failing the whole call', async () => {
    rememberArtworks([artwork('a')]);
    const result = await call('lookup_artwork', {
      artworkIds: ['a', 'ghost'],
    });
    expect(result.ok).toBe(true);
    expect(result.artworks).toHaveLength(1);
    expect(result.unresolved).toEqual(['ghost']);
  });
});

describe('shared canvas', () => {
  it('get_view_context reports the human’s page and observed results', async () => {
    const result = await call('get_view_context');
    expect(result.page).toMatchObject({
      path: '/collections/nga/search',
      collection: 'nga',
      onSearchPage: true,
    });
    expect(result.humanSearch).toMatchObject({ query: 'storm', active: true });
    expect(result.humanResults).toBeNull();
  });

  it('set_results navigates the human’s own grid for a query', async () => {
    const result = await call('set_results', {
      query: 'moonlight on water',
      colour: 'navy',
    });
    expect(navigate).toHaveBeenCalledWith(
      '/collections/nga/search?q=moonlight+on+water&colour=navy'
    );
    expect(result.navigatedTo).toContain('q=moonlight');
  });

  it('set_results pins a curated set onto the shared canvas', async () => {
    rememberArtworks([artwork('a'), artwork('b')]);
    const result = await call('set_results', {
      artworkIds: ['a', 'b', 'ghost'],
      note: 'the two with the storm-lit horizon',
    });
    expect(result.pinned).toBe(2);
    expect(result.unresolved).toEqual(['ghost']);
    expect(navigate).not.toHaveBeenCalled();

    const pinned = getWebMcpState().agentResults;
    expect(pinned?.origin).toBe('agent');
    expect(pinned?.note).toBe('the two with the storm-lit horizon');
    expect(pinned?.items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('set_results refuses an empty instruction', async () => {
    const result = await call('set_results', {});
    expect(result.error.code).toBe('INVALID_INPUT');
  });

  it('show_artwork opens the work on the canvas', async () => {
    rememberArtworks([artwork('a')]);
    const result = await call('show_artwork', {
      artworkId: 'a',
      note: 'look at the horizon',
    });
    expect(result.ok).toBe(true);
    const focused = getWebMcpState().focused;
    expect(focused?.origin).toBe('agent');
    expect(focused?.artwork.id).toBe('a');
    expect(focused?.note).toBe('look at the horizon');
  });

  it('show_artwork will not invent an artwork it has not seen', async () => {
    const result = await call('show_artwork', { artworkId: 'ghost' });
    expect(result.error.code).toBe('ARTWORK_NOT_IN_SESSION');
    expect(getWebMcpState().focused).toBeNull();
  });
});

describe('mutating tools', () => {
  it('parks create_collection until the human approves on the page', async () => {
    const pending = call('create_collection', { name: 'Storm-lit seascapes' });

    // The call must not resolve while consent is outstanding.
    await Promise.resolve();
    const confirmation = getWebMcpState().pendingConfirmations[0];
    expect(confirmation?.toolName).toBe('create_collection');
    expect(confirmation?.title).toContain('Storm-lit seascapes');
    expect(getWebMcpState().panelOpen).toBe(true);

    confirmation!.resolve(true);
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.shortlist.name).toBe('Storm-lit seascapes');
    expect(getWebMcpState().pendingConfirmations).toHaveLength(0);
  });

  it('fails closed when the human declines', async () => {
    const pending = call('create_collection', { name: 'Nope' });
    await Promise.resolve();
    getWebMcpState().pendingConfirmations[0]!.resolve(false);

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('DECLINED_BY_USER');
  });

  it('add_to_collection writes only after approval', async () => {
    rememberArtworks([artwork('a')]);
    const created = call('create_collection', { name: 'Shortlist' });
    await Promise.resolve();
    getWebMcpState().pendingConfirmations[0]!.resolve(true);
    await created;

    const pending = call('add_to_collection', { artworkIds: ['a'] });
    await Promise.resolve();
    const confirmation = getWebMcpState().pendingConfirmations[0];
    expect(confirmation?.title).toContain('Shortlist');
    confirmation!.resolve(true);

    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.shortlist.size).toBe(1);
  });

  it('add_to_collection reports a missing shortlist rather than creating one', async () => {
    rememberArtworks([artwork('a')]);
    const result = await call('add_to_collection', { artworkIds: ['a'] });
    expect(result.error.code).toBe('SHORTLIST_NOT_FOUND');
    expect(result.error.hint).toContain('create_collection');
  });
});

describe('browse_collection and get_search_quota', () => {
  it('browse builds the route’s query string and reports paging', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          results: [artwork('a')],
          count: 1,
          total: 4200,
          limit: 24,
          offset: 0,
          hasMore: true,
        },
      })
    );

    const result = await call('browse_collection', { sortBy: 'nonsense' });
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.pathname).toBe('/api/public-search/nga/browse');
    expect(url.searchParams.get('sort_by')).toBe('title');
    expect(url.searchParams.get('limit')).toBe('24');
    expect(result.total).toBe(4200);
    expect(result.hasMore).toBe(true);
  });

  it('quota surfaces the real shared budget and its scope', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        success: true,
        data: { limit: 1000, used: 12, remaining: 988 },
      })
    );
    const result = await call('get_search_quota');
    expect(result).toMatchObject({ limit: 1000, used: 12, remaining: 988 });
    expect(result.scope).toContain('Shared');
  });
});
