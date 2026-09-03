import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetArtworkIndexForTest, rememberArtworks } from '../artwork-index';
import {
  __resetWebMcpStateForTest,
  getWebMcpState,
  setIndexJob,
} from '../store';
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
      'describe_artwork',
      'get_view_context',
      'set_results',
      'show_artwork',
      'create_collection',
      'add_to_collection',
      'index_zip',
      'index_folder',
      'get_index_status',
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

  it('marks the read tools readOnly and the rest not', () => {
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
      // Polling a job writes nothing; the two tools that upload images do.
      'get_index_status',
    ]);
  });

  it('documents every property of the nested file list too', () => {
    const items = tools.get('index_folder')!.inputSchema.properties?.files
      ?.items as { properties?: Record<string, { description?: string }> };
    expect(Object.keys(items.properties ?? {})).toEqual(['url', 'name']);
    for (const schema of Object.values(items.properties ?? {})) {
      expect(schema.description).toBeTruthy();
    }
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
    expect(result.humanSearchUrl).toBe('/nga/search?colour=rust');
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
      '/nga/search?q=moonlight+on+water&colour=navy'
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

describe('describe_artwork', () => {
  it('posts to the describe route and returns the caption with provenance', async () => {
    rememberArtworks([artwork('a')]);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          artworkId: 'a',
          collectionId: 'nga',
          caption: 'A grey sea under a wide sky, one small sail off centre.',
          model: 'gpt-5.6-luna',
          cached: false,
          persisted: true,
        },
      })
    );

    const result = await call('describe_artwork', { artwork: 'a' });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      caption: 'A grey sea under a wide sky, one small sail off centre.',
      model: 'gpt-5.6-luna',
      cached: false,
      persisted: true,
    });
    expect(result.next).toContain('show_artwork');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('/api/public-describe');
    expect(JSON.parse(String(init?.body))).toEqual({
      collectionId: 'nga',
      artworkId: 'a',
    });
  });

  it('passes an allowlisted model through when asked', async () => {
    rememberArtworks([artwork('a')]);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          artworkId: 'a',
          collectionId: 'nga',
          caption: 'A dense still life.',
          model: 'gpt-5.6-terra',
          cached: false,
          persisted: true,
        },
      })
    );

    const result = await call('describe_artwork', {
      artwork: 'a',
      model: 'gpt-5.6-terra',
    });

    expect(result.model).toBe('gpt-5.6-terra');
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toMatchObject({
      model: 'gpt-5.6-terra',
    });
  });

  it('refuses ids this page has not seen without spending a model call', async () => {
    const fetchMock = vi.mocked(fetch);

    const result = await call('describe_artwork', { artwork: 'ghost' });

    expect(result.error.code).toBe('ARTWORK_NOT_IN_SESSION');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the API failure codes with a recovery hint', async () => {
    rememberArtworks([artwork('a')]);
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: {
            code: 'DESCRIBE_RATE_LIMITED',
            message: 'Only 20 descriptions may be generated per hour.',
          },
        },
        429
      )
    );

    const result = await call('describe_artwork', { artwork: 'a' });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('DESCRIBE_RATE_LIMITED');
    expect(result.error.hint).toContain('hourly description budget');
  });
});

// ---------------------------------------------------------------------------
// Indexing: index_zip / index_folder / get_index_status
// ---------------------------------------------------------------------------

const imageBytes = (fill: number, length = 1024) =>
  new Uint8Array(new ArrayBuffer(length)).fill(fill);

const buildZip = async (entries: Record<string, Uint8Array | string>) => {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return zip.generateAsync({ type: 'uint8array' });
};

const waitFor = async (predicate: () => boolean, label: string) => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for: ${label}`);
};

/** Resolves the confirmation the mutating tool just parked. */
const answerConfirmation = async (approved: boolean) => {
  await Promise.resolve();
  const confirmation = getWebMcpState().pendingConfirmations[0];
  if (!confirmation) throw new Error('no confirmation was requested');
  confirmation.resolve(approved);
  return confirmation;
};

/**
 * Stands in for the six anonymous `/api/public-index/*` proxy routes plus the
 * remote files the agent points at, so a zip can be driven all the way from a
 * data: URI to a searchable collection without a network.
 */
const stubIndexingApi = (
  options: {
    batchSize?: number;
    /** Held open to prove the tool returns before any upload finishes. */
    itemsGate?: Promise<void>;
    status?: Record<string, unknown>;
    statusResponse?: Response;
    searchResults?: unknown[];
    /** Non-2xx to prove a failed search does not take the status read down. */
    searchStatus?: number;
  } = {}
) => {
  const remote = new Map<string, { body: BlobPart; type: string }>();
  const forms: FormData[] = [];
  const api = {
    remote,
    forms,
    jobBody: null as any,
    itemsAttempts: 0,
    searchBody: null as any,
    completeBody: null as any,
    statusCalls: 0,
    searchCalls: 0,
    /** Register a URL the agent may pass as zipUrl / files[].url. */
    serve(url: string, body: BlobPart, type: string) {
      remote.set(url, { body, type });
      return url;
    },
  };

  let processed = 0;

  vi.mocked(fetch).mockImplementation((async (
    input: RequestInfo | URL,
    init: RequestInit = {}
  ) => {
    const url = String(input);

    const file = remote.get(url);
    if (file) {
      return new Response(file.body, {
        headers: { 'Content-Type': file.type },
      });
    }
    if (url.startsWith('data:') || url.startsWith('http')) {
      // Nothing served it: this is what a CORS-blocked fetch looks like.
      throw new TypeError(`Failed to fetch ${url}`);
    }

    if (url === '/api/public-index/jobs') {
      api.jobBody = JSON.parse(String(init.body));
      return Response.json({
        success: true,
        data: {
          jobId: 'job-1',
          collectionId: 'collection-1',
          accepted: api.jobBody.files
            .filter((entry: { name: string }) => !entry.name.endsWith('.txt'))
            .map((entry: { name: string }) => entry.name),
          batchSize: options.batchSize ?? 4,
        },
      });
    }

    if (url.endsWith('/items')) {
      api.itemsAttempts += 1;
      if (options.itemsGate) await options.itemsGate;
      const form = init.body as FormData;
      forms.push(form);
      processed += form.getAll('files').length;
      return Response.json({
        success: true,
        data: {
          jobId: 'job-1',
          state: 'running',
          processed,
          total: 2,
          collectionId: 'collection-1',
          errors: [],
        },
      });
    }

    if (url.endsWith('/complete')) {
      api.completeBody = JSON.parse(String(init.body ?? '{}'));
      return Response.json({ success: true, data: { jobId: 'job-1' } });
    }

    if (url.endsWith('/status')) {
      api.statusCalls += 1;
      if (options.statusResponse) return options.statusResponse;
      return Response.json({
        success: true,
        data: {
          jobId: 'job-1',
          state: 'running',
          processed: 1,
          total: 2,
          collectionId: 'collection-1',
          collectionName: 'Studio scans',
          errors: [],
          failed: 0,
          searchable: true,
          notice: null,
          ...options.status,
        },
      });
    }

    if (url.endsWith('/search')) {
      api.searchCalls += 1;
      api.searchBody = JSON.parse(String(init.body));
      if (options.searchStatus && options.searchStatus >= 400) {
        return Response.json(
          { success: false, error: { code: 'INDEX_SEARCH_FAILED' } },
          { status: options.searchStatus }
        );
      }
      return Response.json({
        success: true,
        data: {
          jobId: 'job-1',
          collectionId: 'collection-1',
          query: api.searchBody.query,
          results: options.searchResults ?? [],
        },
      });
    }

    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch);

  return api;
};

const ZIP_URI = 'data:application/zip;base64,ZIPFIXTURE';

const serveFixtureZip = async (api: ReturnType<typeof stubIndexingApi>) => {
  const bytes = await buildZip({
    'photos/wave-01.jpg': imageBytes(1),
    'photos/wave-02.png': imageBytes(2),
    'photos/readme.txt': 'not an image',
    'photos/metadata.csv': 'filename,title,artist\nwave-01.jpg,Blue Wave,Hokusai\n',
  });
  return api.serve(ZIP_URI, bytes as BlobPart, 'application/zip');
};

describe('index_zip', () => {
  it('asks on the page, then returns a job handle without waiting for the upload', async () => {
    // /items never settles: the tool must still return, because indexing is a
    // job the agent polls, not something an execute() may block on.
    const api = stubIndexingApi({ itemsGate: new Promise<void>(() => {}) });
    await serveFixtureZip(api);

    const pending = call('index_zip', {
      zipUrl: ZIP_URI,
      collectionName: 'Studio scans',
    });
    const confirmation = await answerConfirmation(true);
    expect(confirmation.toolName).toBe('index_zip');
    expect(confirmation.title).toContain('Studio scans');

    const result = await pending;
    expect(result).toMatchObject({
      ok: true,
      jobId: 'job-1',
      collectionId: 'collection-1',
      collectionName: 'Studio scans',
      source: 'zip',
      state: 'queued',
    });
    expect(result.poll).toMatchObject({
      tool: 'get_index_status',
      arguments: { jobId: 'job-1' },
    });
    expect(result.next).toContain('get_index_status');
    expect(result.next).toContain('show_artwork');
    expect(() => JSON.stringify(result)).not.toThrow();

    // The archive was planned server-side; nothing was uploaded yet.
    expect(api.jobBody.source).toBe('zip');
    expect(api.jobBody.orgId).toBe('webmcp-index');
    expect(api.jobBody.collectionName).toBe('Studio scans');
    expect(
      api.jobBody.files.map((entry: { name: string }) => entry.name)
    ).toEqual(['wave-01.jpg', 'wave-02.png', 'readme.txt']);

    // The tool returned while the first upload is still in flight, which is
    // the whole point: execute() must not wait for the job.
    await waitFor(() => api.itemsAttempts === 1, 'the first upload to start');
    expect(api.forms).toHaveLength(0);
  });

  it('keeps uploading after the host cancels the tool call', async () => {
    // The host's signal is scoped to execute(); the pump outlives it. One
    // image per batch, so the second batch proves the job was not cancelled.
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = stubIndexingApi({ batchSize: 1, itemsGate: gate });
    await serveFixtureZip(api);

    const controller = new AbortController();
    const pending = tools
      .get('index_zip')!
      .execute({ zipUrl: ZIP_URI }, { signal: controller.signal }) as Promise<
      Record<string, any>
    >;
    await answerConfirmation(true);
    const result = await pending;
    expect(result.ok).toBe(true);

    controller.abort();
    release();

    await waitFor(() => api.completeBody !== null, 'the job to close');
    expect(api.forms).toHaveLength(2);
    // Closed cleanly — not with "Indexing was cancelled."
    expect(api.completeBody).toEqual({});
  });

  it('fails closed when the human declines, without touching the network', async () => {
    const api = stubIndexingApi();
    await serveFixtureZip(api);

    const pending = call('index_zip', { zipUrl: ZIP_URI });
    await answerConfirmation(false);

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('DECLINED_BY_USER');
    expect(api.jobBody).toBeNull();
  });

  it('reports a file that is not a zip as a recoverable error', async () => {
    const api = stubIndexingApi();
    api.serve(ZIP_URI, imageBytes(9) as BlobPart, 'application/zip');

    const pending = call('index_zip', { zipUrl: ZIP_URI });
    await answerConfirmation(true);

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_ARCHIVE');
    expect(result.error.hint).toContain('index_folder');
  });

  it('says so plainly when the browser cannot read the URL', async () => {
    stubIndexingApi();
    const pending = call('index_zip', {
      zipUrl: 'https://blocked.example/archive.zip',
    });
    await answerConfirmation(true);

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('FILE_FETCH_BLOCKED');
    expect(result.error.hint).toContain('data: URI');
  });

  it('rejects a missing zipUrl before asking the human anything', async () => {
    stubIndexingApi();
    const result = await call('index_zip', {});
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(getWebMcpState().pendingConfirmations).toHaveLength(0);
  });
});

describe('index_folder', () => {
  const JPG = 'data:image/jpeg;base64,ONE';
  const PNG = 'data:image/png;base64,TWO';

  it('fetches each file, applies an inline CSV, and names what it could not read', async () => {
    const api = stubIndexingApi({ batchSize: 2 });
    api.serve(JPG, imageBytes(1) as BlobPart, 'image/jpeg');
    api.serve(PNG, imageBytes(2) as BlobPart, 'image/png');

    const pending = call('index_folder', {
      files: [
        { url: JPG, name: 'wave-01.jpg' },
        { url: PNG, name: 'wave-02.png' },
        { url: 'https://blocked.example/missing.jpg', name: 'missing.jpg' },
      ],
      collectionName: 'Folder drop',
      metadataCsv: 'filename,title,artist\nwave-01.jpg,Blue Wave,Hokusai\n',
    });
    const confirmation = await answerConfirmation(true);
    expect(confirmation.title).toContain('3 files');

    const result = await pending;
    expect(result).toMatchObject({
      ok: true,
      jobId: 'job-1',
      source: 'files',
      submitted: 2,
      metadataCsvApplied: true,
    });
    expect(result.unreadable).toHaveLength(1);
    expect(result.unreadable[0].url).toContain('blocked.example');

    // The CSV rides the same sidecar path a folder's own CSV would.
    expect(api.jobBody.source).toBe('files');
    expect(
      api.jobBody.files.map((entry: { name: string }) => entry.name)
    ).toEqual(['wave-01.jpg', 'wave-02.png']);

    await waitFor(() => api.forms.length > 0, 'the first batch');
    const metadata = JSON.parse(String(api.forms[0]!.get('metadata')));
    expect(metadata['wave-01.jpg']).toMatchObject({
      title: 'Blue Wave',
      artist: 'Hokusai',
    });
  });

  it('fails with a usable message when nothing could be read', async () => {
    const api = stubIndexingApi();
    const pending = call('index_folder', {
      files: [{ url: 'https://blocked.example/a.jpg', name: 'a.jpg' }],
    });
    await answerConfirmation(true);

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('NO_READABLE_FILES');
    expect(result.error.hint).toContain('data: URIs');
    expect(api.jobBody).toBeNull();
  });

  it('rejects an empty file list before asking the human anything', async () => {
    stubIndexingApi();
    const result = await call('index_folder', { files: [] });
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(getWebMcpState().pendingConfirmations).toHaveLength(0);
  });
});

describe('get_index_status', () => {
  const indexedHit = {
    id: 'idx-1',
    similarity: 0.8123,
    title: 'Blue Wave',
    artist: 'Hokusai',
    year: 1831,
    medium: 'woodblock print',
    classification: 'Print',
    description: 'A cresting wave.',
    original_filename: 'wave-01.jpg',
    imageUrl: '/api/public-index/assets/asset-1',
  };

  it('reports progress and tells the agent how to poll', async () => {
    const api = stubIndexingApi({
      status: { state: 'running', processed: 1, total: 4, searchable: true },
    });

    const result = await call('get_index_status', { jobId: 'job-1' });
    expect(result).toMatchObject({
      ok: true,
      jobId: 'job-1',
      state: 'running',
      processed: 1,
      total: 4,
      collectionId: 'collection-1',
      errors: [],
      searchable: true,
      done: false,
    });
    expect(result.next).toContain('Poll again');
    expect(api.searchCalls).toBe(0);
  });

  it('searches the collection the job just built and hands the ids to the canvas', async () => {
    const api = stubIndexingApi({
      status: {
        state: 'complete',
        processed: 2,
        total: 2,
        searchable: true,
        collectionName: 'Studio scans',
      },
      searchResults: [indexedHit],
    });

    const result = await call('get_index_status', {
      jobId: 'job-1',
      query: 'blue wave',
      topK: 5,
    });

    expect(api.searchBody).toEqual({ query: 'blue wave', topK: 5 });
    expect(result.done).toBe(true);
    expect(result.search.count).toBe(1);
    expect(result.search.results[0]).toMatchObject({
      id: 'idx-1',
      title: 'Blue Wave',
      artist: 'Hokusai',
      year: 1831,
      similarity: 0.812,
      imageUrl: '/api/public-index/assets/asset-1',
      // The human's own files carry no institutional citation. Do not invent one.
      sourceUrl: null,
      sourceInstitution: null,
    });

    // The beat the demo turns on: a work that was inside a zip a minute ago is
    // now addressable by the tools that already existed.
    const shown = await call('show_artwork', {
      artworkId: 'idx-1',
      note: 'from your archive',
    });
    expect(shown.ok).toBe(true);
    expect(getWebMcpState().focused?.artwork.id).toBe('idx-1');
    const looked = await call('lookup_artwork', { artworkId: 'idx-1' });
    expect(looked.artworks[0].description).toBe('A cresting wave.');
  });

  it('calls an empty mid-job search propagation lag, not an empty collection', async () => {
    // Measured on staging: `searchable: true` lands ~15s before Vectorize will
    // return the vectors it refers to. Without this note an agent reports a
    // working collection as empty.
    stubIndexingApi({
      status: { state: 'running', processed: 4, total: 25, searchable: true },
      searchResults: [],
    });

    const result = await call('get_index_status', {
      jobId: 'job-1',
      query: 'blue wave',
    });

    expect(result.search.count).toBe(0);
    expect(result.search.note).toContain('propagation lag');
    expect(result.search.note).toContain('4 of 25');
  });

  it('still explains the lag on an empty search just after the job finishes', async () => {
    // The last image is embedded about a second before the job reports
    // `complete`, so the ~15s Vectorize window straddles that transition. An
    // agent told "indexing finished" queries straight into it, and without a
    // note it reports a healthy collection as empty.
    stubIndexingApi({
      status: { state: 'complete', processed: 2, total: 2, searchable: true },
      searchResults: [],
    });

    const result = await call('get_index_status', {
      jobId: 'job-1',
      query: 'blue wave',
    });
    expect(result.search.count).toBe(0);
    expect(result.search.note).toContain('Repeat it once');
    expect(result.search.note).not.toContain('of 2 are embedded so far');
  });

  it('says nothing about lag when the collection embedded nothing at all', async () => {
    stubIndexingApi({
      status: { state: 'complete', processed: 0, total: 0, searchable: true },
      searchResults: [],
    });

    const result = await call('get_index_status', {
      jobId: 'job-1',
      query: 'blue wave',
    });
    expect(result.search.count).toBe(0);
    expect(result.search.note).toBeUndefined();
  });

  it('keeps the status readable when the search itself fails', async () => {
    stubIndexingApi({
      status: { state: 'running', processed: 3, total: 8, searchable: true },
      searchStatus: 502,
    });

    const result = await call('get_index_status', {
      jobId: 'job-1',
      query: 'blue wave',
    });
    // The progress read is the point of the tool; a failed search must not
    // take it down with it.
    expect(result.ok).not.toBe(false);
    expect(result.processed).toBe(3);
    expect(result.total).toBe(8);
    expect(result.search.count).toBe(0);
    expect(result.search.error).toBeTruthy();
  });

  it('passes the collection-specific suggestions through to the agent once the job is done', async () => {
    const suggestions = {
      source: 'metadata' as const,
      generatedAt: '2026-09-03T00:00:00.000Z',
      suggestions: [
        {
          id: 'artist:hokusai',
          type: 'artist' as const,
          label: 'Works by Hokusai',
          query: 'Hokusai',
        },
      ],
    };
    stubIndexingApi({
      status: { state: 'complete', processed: 2, total: 2, suggestions },
    });

    const result = await call('get_index_status', { jobId: 'job-1' });
    expect(result.suggestions).toEqual(suggestions);
    expect(result.next).toContain('suggestions');
  });

  it('leaves suggestions null while a job is still running', async () => {
    stubIndexingApi({
      status: { state: 'running', processed: 1, total: 4, suggestions: null },
    });

    const result = await call('get_index_status', { jobId: 'job-1' });
    expect(result.suggestions).toBeNull();
  });

  it('does not search a job that has embedded nothing yet', async () => {
    const api = stubIndexingApi({
      status: { state: 'queued', processed: 0, total: 4, searchable: false },
    });

    const result = await call('get_index_status', {
      jobId: 'job-1',
      query: 'blue wave',
    });
    expect(api.searchCalls).toBe(0);
    expect(result.search).toBeUndefined();
    expect(result.searchSkipped).toContain('Poll again');
  });

  it('surfaces an unknown job as a structured error with recovery advice', async () => {
    stubIndexingApi({
      statusResponse: jsonResponse(
        { success: false, error: { code: 'NOT_FOUND', message: 'Indexing job not found.' } },
        404
      ),
    });

    const result = await call('get_index_status', { jobId: 'ghost' });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('NOT_FOUND');
    expect(result.error.hint).toContain('index_zip');
  });

  it('requires a jobId', async () => {
    const result = await call('get_index_status', {});
    expect(result.error.code).toBe('INVALID_INPUT');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('propagates an abort instead of swallowing it', async () => {
    vi.mocked(fetch).mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    );
    await expect(
      tools
        .get('get_index_status')!
        .execute({ jobId: 'job-1' }, { signal: new AbortController().signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});


describe('searching a collection built on this page', () => {
  /**
   * `/try` exists so a visitor can index their own zip and search it in the
   * same tab. The public-search routes serve published collections and reject
   * the anonymous indexing sandbox, so while an index job is live the search
   * tools have to reach it through its own job route — otherwise "show me
   * stormy seascapes" silently answers from the NGA catalogue instead of the
   * collection the human is looking at.
   */
  const liveJob = () =>
    setIndexJob({
      jobId: 'job-1',
      collectionId: 'collection-1',
      collectionName: 'NGA 100',
      origin: 'human',
      source: 'zip',
      at: Date.now(),
    });

  const indexedHit = {
    id: 'indexed-1',
    similarity: 0.62,
    title: 'Estuary at Day’s End',
    artist: 'Simon de Vlieger',
    year: 1640,
    medium: 'oil on panel',
    classification: 'Painting',
    description: null,
    original_filename: 'nga-1028.jpg',
    imageUrl: '/api/public-index/assets/asset-1',
  };

  it('search_artworks queries the indexed collection, not the published one', async () => {
    liveJob();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          collectionId: 'collection-1',
          results: [indexedHit],
          interpretation: {
            parserVersion: 'llm-intent-v1',
            filters: { medium: 'oil on panel' },
            rewrittenQuery: 'stormy seascape',
            rationale: 'matched the collection’s own medium values',
          },
        },
      })
    );

    const result = await call('search_artworks', { query: 'stormy seascapes' });

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/public-index/job-1/search');
    expect(result.indexed).toBe(true);
    expect(result.collectionId).toBe('collection-1');
    expect(result.count).toBe(1);
    expect(result.interpretation).toMatchObject({
      parserVersion: 'llm-intent-v1',
    });
  });

  it('still reaches the published collection when one is named', async () => {
    liveJob();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { results: [artwork('a')], count: 1, queryTime: 5 },
      })
    );

    await call('search_artworks', { query: 'storm', collection: 'nga' });

    expect(fetchMock.mock.calls[0]![0]).toBe('/api/public-search/nga/text');
  });

  it('search_by_image queries the indexed collection through its job route', async () => {
    liveJob();
    rememberArtworks([
      artwork('seed', { imageUrl: 'https://assets.example/seed.jpg' }),
    ]);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://assets.example/')) {
        return new Response(new Blob([new Uint8Array([1, 2, 3])]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        });
      }
      return jsonResponse({
        success: true,
        data: { collectionId: 'collection-1', results: [indexedHit] },
      });
    }) as unknown as typeof fetch);

    const result = await call('search_by_image', { artworkId: 'seed' });

    const called = fetchMock.mock.calls.map((entry) => String(entry[0]));
    expect(called).toContain('/api/public-index/job-1/image');
    expect(result.indexed).toBe(true);
    expect(result.count).toBe(1);
  });

  it('set_results fills the canvas instead of navigating away from the collection', async () => {
    liveJob();
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        success: true,
        data: { collectionId: 'collection-1', results: [indexedHit] },
      })
    );

    const result = await call('set_results', { query: 'stormy seascapes' });

    // Navigating would leave the page holding the collection — and lose it.
    expect(navigate).not.toHaveBeenCalled();
    expect(result.shown).toBe(1);
    expect(getWebMcpState().agentResults?.items).toHaveLength(1);
    expect(getWebMcpState().agentResults?.items[0]!.title).toBe(
      'Estuary at Day’s End'
    );
  });

  it('set_results still navigates the published collection’s own grid', async () => {
    const result = await call('set_results', { query: 'moonlight' });

    expect(navigate).toHaveBeenCalledWith('/nga/search?q=moonlight');
    expect(result.navigatedTo).toBe('/nga/search?q=moonlight');
  });
});
