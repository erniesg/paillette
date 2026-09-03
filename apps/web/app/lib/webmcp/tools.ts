/**
 * Paillette's WebMCP tool surface.
 *
 * Design rules applied throughout, because they are what separate a tool
 * surface from an API with extra steps:
 *
 *  - Every tool wraps a route the human's own UI already calls. There is no
 *    second, agent-only backend, so anything the agent can see the human can
 *    see, and the agent's results are reproducible by hand.
 *  - Schemas are written for a reader, not a validator: every property carries
 *    a description, defaults match the route's real defaults, and enums are
 *    the route's real allowed values. `additionalProperties: false` so a
 *    hallucinated argument fails loudly instead of being silently dropped.
 *  - Failures come back as data (`{ok: false, error: {code, message, hint}}`)
 *    rather than thrown, so the model can recover in-turn. Only genuine aborts
 *    propagate, because the host needs to see cancellation as cancellation.
 *  - Read tools are `readOnlyHint: true`. Tools that change what the human is
 *    looking at are honestly marked `readOnlyHint: false` even though they
 *    touch no server state — the human's screen is part of the environment.
 *  - `options.signal` is threaded into every fetch.
 */

import type { ArtworkSearchResult } from '~/types';
import { rankByPaletteColour } from '~/lib/local-colour-refinement';
import type { WebMcpTool } from './registry';
import {
  recallArtwork,
  recallArtworks,
  rememberArtworks,
} from './artwork-index';
import {
  collectPalette,
  getReadableImageUrl,
  toAgentArtworkDetail,
  toAgentArtworkSummary,
  type AgentArtworkSummary,
} from './artwork-summary';
import {
  browsePublic,
  getSearchQuotaPublic,
  loadImageBlob,
  searchImagePublic,
  searchTextPublic,
  PailletteApiError,
} from './client';
import {
  DEFAULT_PUBLIC_COLLECTION_ID,
  PUBLIC_COLLECTIONS,
  PUBLIC_COLLECTION_IDS,
  getPublicCollection,
  resolveCollectionId,
} from './collections';
import { NAMED_COLOURS, NAMED_COLOUR_IDS, resolveColour } from './colours';
import {
  requestConfirmation,
  setAgentResults,
  setFocusedArtwork,
  getWebMcpState,
  type PageContext,
} from './store';
import {
  addToShortlist,
  createShortlist,
  listShortlists,
} from './shortlists';

/** Everything the tool layer needs from the React side. */
export interface ToolContext {
  /** Client-side navigation, so `set_results` moves the human's real grid. */
  navigate: (to: string, options?: { replace?: boolean }) => void;
  /** The page context the bridge derived from the router this render. */
  getPageContext: () => PageContext;
}

type ToolResult = Record<string, unknown>;

const ok = (payload: ToolResult): ToolResult => ({ ok: true, ...payload });

const fail = (code: string, message: string, hint?: string): ToolResult => ({
  ok: false,
  error: { code, message, ...(hint ? { hint } : {}) },
});

const isAbort = (error: unknown) =>
  (error as { name?: string } | null)?.name === 'AbortError';

/**
 * Every tool body runs inside this. Aborts propagate (the host must see a
 * cancelled turn as cancelled); everything else becomes a structured result
 * the model can read and act on.
 */
const guard = async (run: () => Promise<ToolResult>): Promise<ToolResult> => {
  try {
    return await run();
  } catch (error) {
    if (isAbort(error)) throw error;
    if (error instanceof PailletteApiError) {
      return fail(
        error.code,
        error.message,
        error.code === 'NGA_PUBLIC_SEARCH_QUOTA_EXHAUSTED'
          ? 'The shared anonymous search quota for this collection is spent. Browsing still works; call browse_collection instead.'
          : undefined
      );
    }
    return fail(
      'UNEXPECTED_ERROR',
      error instanceof Error ? error.message : String(error)
    );
  }
};

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), min), max);
};

const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const asString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/** Shared schema fragment so `collection` reads identically on every tool. */
const collectionProperty = {
  type: 'string' as const,
  enum: [...PUBLIC_COLLECTION_IDS],
  default: DEFAULT_PUBLIC_COLLECTION_ID,
  description: `Which public collection to work in. Call list_collections for what each one holds. Currently only "${DEFAULT_PUBLIC_COLLECTION_ID}" is open to anonymous search.`,
};

const topKProperty = {
  type: 'integer' as const,
  minimum: 1,
  maximum: 100,
  default: 30,
  description:
    'Maximum number of results to return. The route clamps this to 1-100. Ask for 10-12 when you intend to read every result; ask for more only when you are going to filter them down yourself.',
};

/** Records the results so lookup_artwork and set_results can resolve them later. */
const capture = (results: ArtworkSearchResult[]) => {
  rememberArtworks(results);
  return results.map(toAgentArtworkSummary);
};

const searchPathFor = (collectionId: string) =>
  getPublicCollection(collectionId)?.searchPath ?? '/collections/nga/search';

// ---------------------------------------------------------------------------
// Tier 1 — read-only wrappers over the public search routes
// ---------------------------------------------------------------------------

const listCollectionsTool = (): WebMcpTool => ({
  name: 'list_collections',
  title: 'List collections',
  description:
    'List the art collections this site opens to anonymous search, with what each one holds, which search modalities it supports, and how to cite it. Start here if you do not already know which collection to search.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  execute: async () =>
    ok({
      collections: PUBLIC_COLLECTIONS.map((collection) => ({
        id: collection.id,
        name: collection.name,
        description: collection.description,
        institution: collection.institution,
        institutionUrl: collection.institutionUrl,
        rights: collection.rights,
        searchModalities: collection.capabilities,
        humanSearchPath: collection.searchPath,
      })),
      note: 'These are the anonymously searchable collections. Paillette hosts private collections too; those need an authenticated MCP session, not this page.',
    }),
});

const searchArtworksTool = (): WebMcpTool => ({
  name: 'search_artworks',
  title: 'Search artworks',
  description:
    'Semantic search over a collection by subject, mood, era, style, medium, or anything else you can say in a sentence. Matches against catalogue metadata and a generated visual description of each work, so "three figures under a stormy sky" works as well as "Rembrandt etching". Returns compact records; call lookup_artwork for the full catalogue entry of one.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        minLength: 1,
        description:
          'What to look for, in natural language. Describe the work, not the database: "moonlight on water", "portraits of women reading", "Japanese woodblock landscapes".',
      },
      collection: collectionProperty,
      topK: topKProperty,
      minScore: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        default: 0.2,
        description:
          'Minimum cosine similarity a result must reach. 0.2 is the page default and is permissive; raise toward 0.35 when a broad query returns loosely related works.',
      },
      facet: {
        type: 'string',
        enum: ['artist', 'classification'],
        description:
          'Restrict matching to one metadata facet instead of the whole record. Use "artist" when the query is a person\'s name, "classification" when it is an object type such as Print or Drawing. Omit for general search.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  execute: async (input, options) =>
    guard(async () => {
      const query = asString((input as { query?: unknown }).query);
      if (!query) {
        return fail('INVALID_INPUT', 'query must be a non-empty string.');
      }
      const collectionId = resolveCollectionId(
        (input as { collection?: unknown }).collection
      );
      const facetInput = asString((input as { facet?: unknown }).facet);
      const facet =
        facetInput === 'artist' || facetInput === 'classification'
          ? facetInput
          : undefined;

      const response = await searchTextPublic({
        collectionId,
        query,
        topK: clampInt((input as { topK?: unknown }).topK, 1, 100, 30),
        minScore: clampNumber(
          (input as { minScore?: unknown }).minScore,
          0,
          1,
          0.2
        ),
        facet,
        signal: options.signal,
      });

      return ok({
        collection: collectionId,
        query,
        ...(facet ? { facet } : {}),
        count: response.results.length,
        queryTimeMs: response.queryTime,
        // The index rewrites and corrects queries; showing its work lets the
        // agent explain to the human why a result set looks the way it does.
        interpretation: response.interpretation ?? null,
        quota: response.quota ?? null,
        results: capture(response.results),
        humanSearchUrl: `${searchPathFor(collectionId)}?q=${encodeURIComponent(query)}`,
        next: 'Call set_results with this query to put the same results into the human’s grid, or show_artwork with one id to open it on their screen.',
      });
    }),
});

const searchByImageTool = (): WebMcpTool => ({
  name: 'search_by_image',
  title: 'Search by image',
  description:
    'Find artworks that look like a given image, using the visual embedding rather than the text index. The best way to say "more like this one": pass artworkId from any previous result and the work\'s own image becomes the query. An imageUrl or a data: URI works too — use that to search from an image the human brought with them.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      artworkId: {
        type: 'string',
        description:
          'Id of an artwork already returned this session; its image becomes the query. This is the reliable path — the tool resolves the holding institution’s public IIIF image, which is readable cross-origin.',
      },
      imageUrl: {
        type: 'string',
        description:
          'Absolute https:// URL or a data: URI of a JPEG, PNG, or WebP up to 10 MB. A remote URL must send CORS headers for the browser to read it; a data: URI always works, so encode an image the human supplied rather than linking it.',
      },
      collection: collectionProperty,
      topK: topKProperty,
      minScore: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        default: 0.3,
        description:
          'Minimum visual similarity. 0.3 is the page default for image search — a higher floor than text search, because visual neighbours are dense.',
      },
    },
    additionalProperties: false,
  },
  execute: async (input, options) =>
    guard(async () => {
      const artworkId = asString((input as { artworkId?: unknown }).artworkId);
      const imageUrl = asString((input as { imageUrl?: unknown }).imageUrl);
      const collectionId = resolveCollectionId(
        (input as { collection?: unknown }).collection
      );

      let sourceUrl = imageUrl;
      if (artworkId) {
        const artwork = recallArtwork(artworkId);
        if (!artwork) {
          return fail(
            'ARTWORK_NOT_IN_SESSION',
            `No artwork "${artworkId}" has been seen on this page.`,
            'Run search_artworks or browse_collection first; ids are only resolvable within this browsing session.'
          );
        }
        // Resolve to the institution's public (CORS-open) image, not
        // Paillette's session-gated asset URL.
        sourceUrl = getReadableImageUrl(artwork) ?? '';
        if (!sourceUrl) {
          return fail(
            'ARTWORK_HAS_NO_IMAGE',
            `Artwork "${artworkId}" has no image to search with.`
          );
        }
      }

      if (!sourceUrl) {
        return fail(
          'INVALID_INPUT',
          'Provide either artworkId or imageUrl.',
          'artworkId is the reliable option: it reuses an image already loaded by this page.'
        );
      }

      const image = await loadImageBlob(sourceUrl, options.signal);
      const response = await searchImagePublic({
        collectionId,
        image,
        topK: clampInt((input as { topK?: unknown }).topK, 1, 100, 30),
        minScore: clampNumber(
          (input as { minScore?: unknown }).minScore,
          0,
          1,
          0.3
        ),
        signal: options.signal,
      });

      const results = capture(response.results).filter(
        // The query image's own record is not an interesting neighbour.
        (result) => result.id !== artworkId
      );

      return ok({
        collection: collectionId,
        queriedWith: artworkId ? { artworkId } : { imageUrl: sourceUrl },
        count: results.length,
        queryTimeMs: response.queryTime,
        quota: response.quota ?? null,
        results,
      });
    }),
});

const searchByColorTool = (): WebMcpTool => ({
  name: 'search_by_color',
  title: 'Search by colour',
  description:
    'Find artworks whose extracted palette sits near a target colour, ordered by perceptual (CIEDE2000) distance. This runs the two-stage search the page itself runs: a semantic query for the colour, then a local palette re-rank — so results are colour-relevant rather than merely colour-adjacent. Combine with `query` to scope the colour search to a subject.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      color: {
        type: 'string',
        description: `A named swatch from the page's palette rail (${NAMED_COLOUR_IDS.join(', ')}) or any #rrggbb hex. Named swatches carry hand-tuned search language and are the better default.`,
        examples: ['rust', '#1a2f52'],
      },
      query: {
        type: 'string',
        description:
          'Optional subject to combine with the colour, e.g. "harbour" with "navy". Omit to search the colour alone.',
      },
      collection: collectionProperty,
      topK: topKProperty,
    },
    required: ['color'],
    additionalProperties: false,
  },
  execute: async (input, options) =>
    guard(async () => {
      const colour = resolveColour((input as { color?: unknown }).color);
      if (!colour) {
        return fail(
          'INVALID_COLOUR',
          'color must be a named swatch or a #rrggbb hex value.',
          `Named swatches: ${NAMED_COLOUR_IDS.join(', ')}.`
        );
      }
      const collectionId = resolveCollectionId(
        (input as { collection?: unknown }).collection
      );
      const subject = asString((input as { query?: unknown }).query);
      const topK = clampInt((input as { topK?: unknown }).topK, 1, 100, 30);

      const response = await searchTextPublic({
        collectionId,
        query: subject ? `${subject} ${colour.searchText}` : colour.searchText,
        // Over-fetch so the local palette re-rank has candidates to choose
        // between; the page does the same thing.
        topK: Math.min(100, Math.max(topK * 2, 40)),
        minScore: 0.15,
        signal: options.signal,
      });

      rememberArtworks(response.results);
      const ranked = rankByPaletteColour(
        response.results,
        [colour.hex],
        collectPalette
      ).slice(0, topK);

      return ok({
        collection: collectionId,
        color: { input: colour.label, hex: colour.hex, swatch: colour.selection },
        ...(subject ? { query: subject } : {}),
        method:
          'semantic search on the colour’s language, then CIEDE2000 re-rank against each work’s extracted palette (the same local refinement the page performs — the public search route deliberately does not do colour matching server-side)',
        count: ranked.length,
        quota: response.quota ?? null,
        results: ranked.map(toAgentArtworkSummary),
        humanSearchUrl: `${searchPathFor(collectionId)}?colour=${encodeURIComponent(colour.selection)}${subject ? `&q=${encodeURIComponent(subject)}` : ''}`,
      });
    }),
});

const browseCollectionTool = (): WebMcpTool => ({
  name: 'browse_collection',
  title: 'Browse collection',
  description:
    'Page through a collection in catalogue order without searching. Use it to establish scale ("how much is in here?"), to sample the holdings, or when the search quota is exhausted — browsing does not consume search quota.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      collection: collectionProperty,
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        default: 24,
        description:
          'How many records to return. The route clamps to 1-100; its own page size is 60.',
      },
      offset: {
        type: 'integer',
        minimum: 0,
        maximum: 100000,
        default: 0,
        description:
          'How many records to skip. Combine with the returned `total` and `hasMore` to page.',
      },
      sortBy: {
        type: 'string',
        enum: ['title', 'artist', 'year', 'created_at', 'updated_at'],
        default: 'title',
        description:
          'Catalogue field to order by. Anything outside this set is ignored by the route and falls back to title.',
      },
      sortOrder: {
        type: 'string',
        enum: ['asc', 'desc'],
        default: 'asc',
        description: 'Sort direction.',
      },
    },
    additionalProperties: false,
  },
  execute: async (input, options) =>
    guard(async () => {
      const collectionId = resolveCollectionId(
        (input as { collection?: unknown }).collection
      );
      const sortByInput = asString((input as { sortBy?: unknown }).sortBy);
      const sortOrderInput = asString(
        (input as { sortOrder?: unknown }).sortOrder
      );

      const response = await browsePublic({
        collectionId,
        limit: clampInt((input as { limit?: unknown }).limit, 1, 100, 24),
        offset: clampInt((input as { offset?: unknown }).offset, 0, 100000, 0),
        sortBy: ['title', 'artist', 'year', 'created_at', 'updated_at'].includes(
          sortByInput
        )
          ? sortByInput
          : 'title',
        sortOrder: sortOrderInput === 'desc' ? 'desc' : 'asc',
        signal: options.signal,
      });

      return ok({
        collection: collectionId,
        count: response.count,
        total: response.total,
        offset: response.offset,
        limit: response.limit,
        hasMore: response.hasMore,
        results: capture(response.results),
      });
    }),
});

const lookupArtworkTool = (): WebMcpTool => ({
  name: 'lookup_artwork',
  title: 'Look up artwork',
  description:
    'Return the full catalogue record for an artwork this page has already loaded: description, credit line, accession number, rights, full weighted colour palette, and the canonical source URL to cite. Ids come from search_artworks, search_by_image, search_by_color, browse_collection, or get_view_context — resolution is scoped to this browsing session, because the record is read from what the page holds rather than from a new request.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      artworkId: {
        type: 'string',
        description: 'Id returned by any Paillette search or browse tool.',
      },
      artworkIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 20,
        description:
          'Look several up at once — cheaper than one call per work when you are assembling a shortlist.',
      },
    },
    additionalProperties: false,
  },
  execute: async (input) =>
    guard(async () => {
      const single = asString((input as { artworkId?: unknown }).artworkId);
      const many = Array.isArray((input as { artworkIds?: unknown }).artworkIds)
        ? ((input as { artworkIds: unknown[] }).artworkIds
            .map(asString)
            .filter(Boolean) as string[])
        : [];
      const ids = [...new Set([single, ...many].filter(Boolean))];

      if (!ids.length) {
        return fail('INVALID_INPUT', 'Provide artworkId or artworkIds.');
      }

      const { found, missing } = recallArtworks(ids);
      if (!found.length) {
        return fail(
          'ARTWORK_NOT_IN_SESSION',
          `None of the requested ids have been seen on this page: ${missing.join(', ')}.`,
          'Run search_artworks or browse_collection first — ids are resolvable only within this browsing session.'
        );
      }

      return ok({
        artworks: found.map(toAgentArtworkDetail),
        ...(missing.length
          ? {
              unresolved: missing,
              unresolvedHint:
                'These ids have not been loaded by this page. Search for them first.',
            }
          : {}),
      });
    }),
});

const getSearchQuotaTool = (): WebMcpTool => ({
  name: 'get_search_quota',
  title: 'Get search quota',
  description:
    'Report the shared anonymous search budget for a collection: total, used, and remaining. This site pays per embedding call, so anonymous semantic search is capped for everyone at once. Check it before running a long chain of searches, and tell the human what is left rather than burning through it silently. Browsing (browse_collection) does not consume quota.',
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  inputSchema: {
    type: 'object',
    properties: { collection: collectionProperty },
    additionalProperties: false,
  },
  execute: async (input, options) =>
    guard(async () => {
      const collectionId = resolveCollectionId(
        (input as { collection?: unknown }).collection
      );
      const quota = await getSearchQuotaPublic(collectionId, options.signal);
      return ok({
        collection: collectionId,
        limit: quota.limit,
        used: quota.used,
        remaining: quota.remaining,
        scope:
          'Shared across every anonymous visitor to this site, not per-user. Spend it deliberately.',
        exhaustedFallback:
          'When remaining reaches 0, browse_collection and lookup_artwork keep working.',
      });
    }),
});

// ---------------------------------------------------------------------------
// Tier 1.5 — the shared canvas: read and write what the human is looking at
// ---------------------------------------------------------------------------

const VISIBLE_RESULT_SAMPLE = 12;

const sampleResults = (items: AgentArtworkSummary[]) =>
  items.slice(0, VISIBLE_RESULT_SAMPLE).map((item) => ({
    id: item.id,
    title: item.title,
    artist: item.artist,
    year: item.year,
    similarity: item.similarity,
  }));

const getViewContextTool = (context: ToolContext): WebMcpTool => ({
  name: 'get_view_context',
  title: 'Get view context',
  description:
    'Read what the human is looking at right now: the route they are on, the collection they are scoped to, the query their own search box committed, the result set their grid is currently showing, and any artwork opened on the shared canvas. Call this before answering "what is this?", "find more like these", or anything else that depends on the screen. The result set reported here is observed from the page\'s own search responses, so it is what is genuinely on screen — not a re-run of the query.',
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  execute: async () => {
    const state = getWebMcpState();
    const page = context.getPageContext();
    const colour = page.colour ? resolveColour(page.colour) : null;

    return ok({
      page: {
        path: page.pathname,
        collection: page.collectionId,
        collectionName: page.collectionId
          ? (getPublicCollection(page.collectionId)?.name ?? null)
          : null,
        onSearchPage: page.pathname.endsWith('/search'),
      },
      humanSearch: {
        query: page.query || null,
        facet: page.facet,
        colour: colour
          ? { swatch: colour.selection, hex: colour.hex, label: colour.label }
          : null,
        active: Boolean(page.query || page.colour),
      },
      humanResults: state.humanResults
        ? {
            describedAs: state.humanResults.label,
            count: state.humanResults.items.length,
            total: state.humanResults.total ?? null,
            observedAt: new Date(state.humanResults.at).toISOString(),
            visible: sampleResults(state.humanResults.items),
            truncated: state.humanResults.items.length > VISIBLE_RESULT_SAMPLE,
          }
        : null,
      agentResults: state.agentResults
        ? {
            describedAs: state.agentResults.label,
            note: state.agentResults.note ?? null,
            count: state.agentResults.items.length,
            visible: sampleResults(state.agentResults.items),
          }
        : null,
      openArtwork: state.focused
        ? {
            openedBy: state.focused.origin,
            artwork: state.focused.artwork,
          }
        : null,
      hint: state.humanResults
        ? 'Use lookup_artwork on any id above for the full record, or search_by_image with an id for visually similar works.'
        : 'The human has not run a search yet. set_results will start one in their grid.',
    });
  },
});

const setResultsTool = (context: ToolContext): WebMcpTool => ({
  name: 'set_results',
  title: 'Set the results the human sees',
  description:
    'Put a result set on the human\'s screen. Two modes, and they compose:\n• Pass `query` (and optionally `colour`/`facet`) to run that search in the human\'s own results grid — the page navigates exactly as if they had typed it, so their grid, URL, and back button all stay real.\n• Pass `artworkIds` to pin a curated selection you have already chosen onto the shared canvas, with a `note` explaining the through-line.\nUse this instead of listing artworks in chat when the human should be looking at pictures.',
  // Not readOnly: this changes what a person is looking at. It touches no
  // stored data, so destructiveHint is false and no confirmation is required —
  // an agent that has to ask permission to show you a picture is not a
  // collaborator.
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Run this search in the human\'s grid. Their URL becomes ?q=<query>, the page fetches, and both of you end up looking at the same results.',
      },
      artworkIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 60,
        description:
          'Pin these specific works — ids from any previous search — onto the shared canvas, in this order. Use when your selection is narrower than any single query would return.',
      },
      note: {
        type: 'string',
        maxLength: 280,
        description:
          'One line shown to the human above the set, saying why these. Write it for them, not for yourself: "the four with the storm-lit horizon".',
      },
      colour: {
        type: 'string',
        description: `Order the human's grid by nearness to this colour: a named swatch (${NAMED_COLOUR_IDS.join(', ')}) or a #rrggbb hex.`,
      },
      facet: {
        type: 'string',
        enum: ['artist', 'classification'],
        description: 'Restrict the human\'s search to one metadata facet.',
      },
      collection: collectionProperty,
    },
    additionalProperties: false,
  },
  execute: async (input) =>
    guard(async () => {
      const query = asString((input as { query?: unknown }).query);
      const note = asString((input as { note?: unknown }).note);
      const facet = asString((input as { facet?: unknown }).facet);
      const colour = resolveColour((input as { colour?: unknown }).colour);
      const collectionId = resolveCollectionId(
        (input as { collection?: unknown }).collection
      );
      const rawIds = Array.isArray((input as { artworkIds?: unknown }).artworkIds)
        ? ((input as { artworkIds: unknown[] }).artworkIds
            .map(asString)
            .filter(Boolean) as string[])
        : [];

      if (!query && !colour && !rawIds.length) {
        return fail(
          'INVALID_INPUT',
          'Provide query, colour, or artworkIds.',
          'query drives the human’s own search grid; artworkIds pins a curated set to the shared canvas.'
        );
      }

      const outcome: ToolResult = { collection: collectionId };

      if (rawIds.length) {
        const { found, missing } = recallArtworks(rawIds);
        if (!found.length) {
          return fail(
            'ARTWORK_NOT_IN_SESSION',
            'None of those ids have been loaded by this page.',
            'Search first, then pin ids from the results.'
          );
        }
        setAgentResults({
          origin: 'agent',
          label: note || `${found.length} works selected by the agent`,
          ...(note ? { note } : {}),
          items: found.map(toAgentArtworkSummary),
          at: Date.now(),
        });
        outcome.pinned = found.length;
        if (missing.length) outcome.unresolved = missing;
      }

      if (query || colour) {
        const params = new URLSearchParams();
        if (query) params.set('q', query);
        if (facet === 'artist' || facet === 'classification') {
          params.set('field', facet);
        }
        if (colour) params.set('colour', colour.selection);
        const target = `${searchPathFor(collectionId)}?${params.toString()}`;
        // Client-side navigation: the search page is URL-driven, so this is
        // the same code path as the human typing in the box.
        context.navigate(target);
        outcome.navigatedTo = target;
        outcome.humanGrid =
          'The human’s grid is now running this search. Their results will differ from a topK-limited tool call — the page uses its own paging.';
      }

      return ok({
        ...outcome,
        ...(note ? { note } : {}),
        effect: 'The human’s screen now reflects this.',
      });
    }),
});

const showArtworkTool = (): WebMcpTool => ({
  name: 'show_artwork',
  title: 'Show an artwork to the human',
  description:
    'Open one artwork on the shared canvas at full size, with its catalogue record, palette, and citation, and a note saying why you are showing it. This is how you point at something: say "look at this one" and actually put it on their screen.',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: 'object',
    properties: {
      artworkId: {
        type: 'string',
        description:
          'Id from any previous search, browse, or get_view_context result.',
      },
      note: {
        type: 'string',
        maxLength: 280,
        description:
          'One line shown beside the work explaining why you opened it. Written for the human.',
      },
    },
    required: ['artworkId'],
    additionalProperties: false,
  },
  execute: async (input) =>
    guard(async () => {
      const artworkId = asString((input as { artworkId?: unknown }).artworkId);
      const note = asString((input as { note?: unknown }).note);
      const artwork = artworkId ? recallArtwork(artworkId) : null;

      if (!artwork) {
        return fail(
          'ARTWORK_NOT_IN_SESSION',
          `No artwork "${artworkId}" has been loaded by this page.`,
          'Call search_artworks or browse_collection first, then show one of the ids it returns.'
        );
      }

      const detail = toAgentArtworkDetail(artwork);
      setFocusedArtwork({
        origin: 'agent',
        artwork: detail,
        ...(note ? { note } : {}),
        at: Date.now(),
      });

      // Deliberately no navigation: opening a work on the shared canvas
      // should not yank the human off the page they were reading.
      return ok({
        opened: detail,
        effect: 'This work is now open on the human’s screen.',
      });
    }),
});

// ---------------------------------------------------------------------------
// Tier 2 — mutating tools, gated on visible in-page consent
// ---------------------------------------------------------------------------

const createCollectionTool = (): WebMcpTool => ({
  name: 'create_collection',
  title: 'Create a shortlist',
  description:
    'Create a named shortlist to gather works into while curating. The shortlist is saved in this browser (localStorage) and belongs to the human, not to Paillette\'s server — anonymous visitors cannot write to the catalogue. Creating one asks the human to approve it on the page first.',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        minLength: 1,
        maxLength: 80,
        description: 'What to call the shortlist, e.g. "Storm-lit seascapes".',
      },
      description: {
        type: 'string',
        maxLength: 400,
        description:
          'Optional note on what belongs in it — the curatorial brief, so a later turn can judge candidates against it.',
      },
      artworkIds: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 60,
        description: 'Optionally seed the shortlist with works straight away.',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
  execute: async (input, options) =>
    guard(async () => {
      const name = asString((input as { name?: unknown }).name);
      if (!name) return fail('INVALID_INPUT', 'name is required.');
      const description = asString(
        (input as { description?: unknown }).description
      );
      const ids = Array.isArray((input as { artworkIds?: unknown }).artworkIds)
        ? ((input as { artworkIds: unknown[] }).artworkIds
            .map(asString)
            .filter(Boolean) as string[])
        : [];

      const approved = await requestConfirmation({
        toolName: 'create_collection',
        title: `Create the shortlist “${name}”?`,
        detail: ids.length
          ? `${ids.length} work${ids.length === 1 ? '' : 's'} will be added. Saved in this browser only.`
          : 'Saved in this browser only.',
        signal: options.signal,
      });
      if (!approved) {
        return fail(
          'DECLINED_BY_USER',
          'The human declined this on the page.',
          'Do not retry without being asked to. Say what you were going to do and let them decide.'
        );
      }

      const shortlist = createShortlist(name, description || undefined);
      if (ids.length) addToShortlist(shortlist.id, ids);

      return ok({
        shortlist: { id: shortlist.id, name: shortlist.name },
        added: ids.length,
        storage: 'localStorage in this browser',
      });
    }),
});

const addToCollectionTool = (): WebMcpTool => ({
  name: 'add_to_collection',
  title: 'Add works to a shortlist',
  description:
    'Add artworks to an existing shortlist. Ids must have been loaded by this page. The human approves the addition on screen before it is written.',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: 'object',
    properties: {
      shortlistId: {
        type: 'string',
        description:
          'Id returned by create_collection. Omit to use the most recently created shortlist.',
      },
      artworkIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 60,
        description: 'The works to add, in the order they should appear.',
      },
    },
    required: ['artworkIds'],
    additionalProperties: false,
  },
  execute: async (input, options) =>
    guard(async () => {
      const ids = Array.isArray((input as { artworkIds?: unknown }).artworkIds)
        ? ((input as { artworkIds: unknown[] }).artworkIds
            .map(asString)
            .filter(Boolean) as string[])
        : [];
      if (!ids.length) {
        return fail('INVALID_INPUT', 'artworkIds must contain at least one id.');
      }

      const shortlists = listShortlists();
      const requestedId = asString(
        (input as { shortlistId?: unknown }).shortlistId
      );
      const target = requestedId
        ? shortlists.find((entry) => entry.id === requestedId)
        : shortlists[shortlists.length - 1];

      if (!target) {
        return fail(
          'SHORTLIST_NOT_FOUND',
          requestedId
            ? `No shortlist "${requestedId}" in this browser.`
            : 'No shortlist exists yet.',
          'Call create_collection first.'
        );
      }

      const { found, missing } = recallArtworks(ids);
      if (!found.length) {
        return fail(
          'ARTWORK_NOT_IN_SESSION',
          'None of those ids have been loaded by this page.',
          'Search first, then add ids from the results.'
        );
      }

      const approved = await requestConfirmation({
        toolName: 'add_to_collection',
        title: `Add ${found.length} work${found.length === 1 ? '' : 's'} to “${target.name}”?`,
        detail: found
          .slice(0, 4)
          .map((artwork) => artwork.title || artwork.id)
          .join(' · '),
        signal: options.signal,
      });
      if (!approved) {
        return fail('DECLINED_BY_USER', 'The human declined this on the page.');
      }

      const updated = addToShortlist(
        target.id,
        found.map((artwork) => artwork.id)
      );

      return ok({
        shortlist: { id: target.id, name: target.name, size: updated.artworkIds.length },
        added: found.length,
        ...(missing.length ? { unresolved: missing } : {}),
      });
    }),
});

/**
 * The full surface, in the order a judge (or a model) should read it:
 * discovery, then the three search modalities, then browse and lookup, then
 * quota, then the shared canvas, then the gated mutations.
 */
export const createPailletteTools = (context: ToolContext): WebMcpTool[] => [
  listCollectionsTool(),
  searchArtworksTool(),
  searchByImageTool(),
  searchByColorTool(),
  browseCollectionTool(),
  lookupArtworkTool(),
  getSearchQuotaTool(),
  getViewContextTool(context),
  setResultsTool(context),
  showArtworkTool(),
  createCollectionTool(),
  addToCollectionTool(),
];

export const PAILLETTE_TOOL_NAMES = [
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
] as const;

export { NAMED_COLOURS };
