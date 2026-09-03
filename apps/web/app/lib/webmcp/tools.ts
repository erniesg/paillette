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
  describeArtworkPublic,
  getSearchQuotaPublic,
  loadAgentFile,
  loadImageBlob,
  searchByExemplarsPublic,
  searchImagePublic,
  searchTextPublic,
  INDEX_ARCHIVE_MAX_BYTES,
  INDEX_FILE_MAX_BYTES,
  PailletteApiError,
} from './client';
import {
  getIndexStatus,
  indexFiles,
  indexZip,
  searchIndexedCollection,
  searchIndexedCollectionByImage,
  IndexingError,
  type IndexJobHandle,
} from '~/lib/indexing-client';
import {
  DEFAULT_PUBLIC_COLLECTION_ID,
  PUBLIC_COLLECTIONS,
  PUBLIC_COLLECTION_IDS,
  getPublicCollection,
  resolveCollectionId,
} from './collections';
import {
  resolveSearchTarget,
  searchPathFor,
  type SearchTarget,
} from './search-target';
import { NAMED_COLOURS, NAMED_COLOUR_IDS, resolveColour } from './colours';
import {
  requestConfirmation,
  setAgentResults,
  setBoard,
  setCanvasView,
  setCompare,
  setFocusedArtwork,
  setIndexJob,
  getWebMcpState,
  type PageContext,
} from './store';
import {
  getExemplars,
  getPinnedIds,
  partitionFlags,
  setFlag,
  type FlagIntent,
} from './flags';
import { runRedeal, BOARD_SIZE } from './redeal';
import { INDEX_CAPS } from './caps';
import { toIndexedArtwork } from './indexed-artwork';
import { getCollectionSuggestions } from './collection-suggestions';
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
          : INDEXING_HINTS[error.code]
      );
    }
    // The indexing client raises its own typed error; keep its code rather
    // than flattening every indexing failure into UNEXPECTED_ERROR.
    if (error instanceof IndexingError) {
      return fail(error.code, error.message, INDEXING_HINTS[error.code]);
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

/** Ids arrive from a model, so tolerate blanks and duplicates without dropping the call. */
const readStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    const id = asString(entry);
    if (id) seen.add(id);
  }
  return [...seen];
};

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

export { resolveSearchTarget };
export type { SearchTarget };

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
      const target = resolveSearchTarget(
        (input as { collection?: unknown }).collection
      );
      const topK = clampInt((input as { topK?: unknown }).topK, 1, 100, 30);

      // A collection built on this page is searched through its job, which is
      // the only route scoped to it — the public-search routes serve published
      // collections and reject the anonymous indexing sandbox by design.
      if (target.kind === 'indexed') {
        const response = await searchIndexedCollection(target.jobId, query, {
          topK: Math.min(topK, 50),
          signal: options.signal,
        });
        const artworks = response.results.map((result) =>
          toIndexedArtwork(
            result,
            response.collectionId,
            target.collectionName
          )
        );
        return ok({
          collection: target.collectionName,
          collectionId: response.collectionId,
          indexed: true,
          query,
          count: artworks.length,
          interpretation: response.interpretation ?? null,
          results: capture(artworks),
          next: 'Call set_results with this query to put the same results into the human’s grid, or show_artwork with one id to open it on their screen.',
        });
      }

      const collectionId = target.collectionId;
      const facetInput = asString((input as { facet?: unknown }).facet);
      const facet =
        facetInput === 'artist' || facetInput === 'classification'
          ? facetInput
          : undefined;

      const response = await searchTextPublic({
        collectionId,
        query,
        topK,
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
      const target = resolveSearchTarget(
        (input as { collection?: unknown }).collection
      );
      const collectionId = target.collectionId;

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
      const topK = clampInt((input as { topK?: unknown }).topK, 1, 100, 30);
      const minScore = clampNumber(
        (input as { minScore?: unknown }).minScore,
        0,
        1,
        0.3
      );

      // Same split as search_artworks: a collection built on this page is
      // reachable only through its own job route.
      if (target.kind === 'indexed') {
        const response = await searchIndexedCollectionByImage(
          target.jobId,
          image,
          { topK: Math.min(topK, 50), minScore, signal: options.signal }
        );
        const artworks = response.results.map((result) =>
          toIndexedArtwork(result, response.collectionId, target.collectionName)
        );
        const results = capture(artworks).filter(
          (result) => result.id !== artworkId
        );
        return ok({
          collection: target.collectionName,
          collectionId: response.collectionId,
          indexed: true,
          queriedWith: artworkId ? { artworkId } : { imageUrl: sourceUrl },
          count: results.length,
          results,
          next: 'Call set_results with these ids to put them on the human’s screen, or show_artwork with one to open it.',
        });
      }

      const response = await searchImagePublic({
        collectionId,
        image,
        topK,
        minScore,
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
      const target = resolveSearchTarget(
        (input as { collection?: unknown }).collection
      );
      const collectionId = target.collectionId;
      const subject = asString((input as { query?: unknown }).query);
      const topK = clampInt((input as { topK?: unknown }).topK, 1, 100, 30);

      // A collection indexed on this page has image vectors but no extracted
      // palettes, so the CIEDE2000 re-rank has nothing to sort by. The
      // semantic half still works — these are jina-clip image vectors, and
      // colour language retrieves against them — so run that and say plainly
      // that the re-rank was skipped rather than implying a palette match.
      if (target.kind === 'indexed') {
        const response = await searchIndexedCollection(
          target.jobId,
          subject ? `${subject} ${colour.searchText}` : colour.searchText,
          { topK: Math.min(topK, 50), signal: options.signal }
        );
        const artworks = response.results.map((result) =>
          toIndexedArtwork(result, response.collectionId, target.collectionName)
        );
        return ok({
          collection: target.collectionName,
          collectionId: response.collectionId,
          indexed: true,
          color: { input: colour.label, hex: colour.hex, swatch: colour.selection },
          ...(subject ? { query: subject } : {}),
          method:
            'semantic search on the colour’s language against this collection’s image vectors. The palette re-rank the published collections get is skipped here: images indexed on this page have no extracted colour palette, so these are colour-relevant rather than palette-matched.',
          count: artworks.length,
          results: capture(artworks),
        });
      }

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
      const browseTarget = resolveSearchTarget(
        (input as { collection?: unknown }).collection
      );
      if (browseTarget.kind === 'indexed') {
        // Paging a collection built on this page has no route of its own, and
        // quietly listing the published catalogue instead would be a wrong
        // answer dressed as a right one.
        return fail(
          'BROWSE_UNAVAILABLE_FOR_INDEXED_COLLECTION',
          `“${browseTarget.collectionName}” was indexed on this page and cannot be paged through.`,
          'Use search_artworks (it searches this collection), or pass collection:"nga" to browse the published catalogue.'
        );
      }
      const collectionId = browseTarget.collectionId;
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

/**
 * The vision model an agent may spend. Mirrors the API route's allowlist —
 * anonymous callers never choose an arbitrary model.
 */
const DESCRIBE_MODELS = ['gpt-5.6-luna', 'gpt-5.6-terra'] as const;

const describeArtworkTool = (): WebMcpTool => ({
  name: 'describe_artwork',
  title: 'Describe artwork',
  description:
    'Generate assistive alt-text for one artwork with a vision model: what is visibly depicted, in one or two plain sentences suitable for a screen reader. Useful for accessibility, and for grounding your own discussion of a work in what it actually shows rather than its catalogue wording. This spends a paid model call from the same shared anonymous budget story as search — the site pays per call and every anonymous caller shares it — so describe works worth reading about, not every result. A generated caption is stored on the record, so describing the same work again returns the stored text instead of spending another call.',
  // Not readOnly: the caption is persisted on the record server-side. It only
  // ever adds text, so destructiveHint is false, and it needs no confirmation
  // — but the cost is honest: the first call for a work spends real money.
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: {
    type: 'object',
    properties: {
      artwork: {
        type: 'string',
        description:
          'Id from any previous search, browse, or get_view_context result — the same ids lookup_artwork resolves.',
      },
      collection: collectionProperty,
      model: {
        type: 'string',
        enum: [...DESCRIBE_MODELS],
        default: 'gpt-5.6-luna',
        description:
          'Which vision model to spend. gpt-5.6-luna is the default and is tuned for this; use gpt-5.6-terra only for a dense composition where the finer read justifies the extra cost.',
      },
    },
    required: ['artwork'],
    additionalProperties: false,
  },
  execute: async (input, options) =>
    guard(async () => {
      const artworkId = asString((input as { artwork?: unknown }).artwork);
      if (!artworkId) {
        return fail(
          'INVALID_INPUT',
          'artwork is required.',
          'Pass an id from search_artworks, browse_collection, or get_view_context.'
        );
      }
      // Fail fast on ids this page has not seen rather than spending a model
      // call on an id the API would refuse anyway.
      if (!recallArtwork(artworkId)) {
        return fail(
          'ARTWORK_NOT_IN_SESSION',
          `No artwork "${artworkId}" has been seen on this page.`,
          'Run search_artworks or browse_collection first; ids are only resolvable within this browsing session.'
        );
      }

      // Same routing as the search tools: a work from a collection indexed on
      // this page has to be described against *that* collection, or the
      // captioner is handed an id the published catalogue has never seen.
      const collectionId = resolveSearchTarget(
        (input as { collection?: unknown }).collection
      ).collectionId;
      const modelInput = asString((input as { model?: unknown }).model);
      const model = (DESCRIBE_MODELS as readonly string[]).includes(modelInput)
        ? (modelInput as (typeof DESCRIBE_MODELS)[number])
        : undefined;

      const result = await describeArtworkPublic({
        collectionId,
        artworkId,
        ...(model ? { model } : {}),
        signal: options.signal,
      });

      return ok({
        artworkId: result.artworkId,
        caption: result.caption,
        model: result.model,
        cached: result.cached,
        persisted: result.persisted,
        ...(result.persisted
          ? {}
          : {
              persistedNote:
                'The caption could not be stored on the record just now; it is still valid to use.',
            }),
        next: 'Call show_artwork with this id to open it on the human’s screen — this caption reads well as its alt text.',
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

/**
 * The flags, split three ways so the model can tell a judgement from a
 * proposal. `provisional` is the agent's own unconfirmed flags — reporting
 * them separately is what stops a model reading its own suggestions back as
 * the human's taste and talking itself in a circle.
 */
const describeFlags = (boardOrder: readonly string[]) => {
  const { hung, filed } = partitionFlags(boardOrder);
  const describe = (flag: (typeof hung)[number]) => {
    const artwork = recallArtwork(flag.artworkId);
    const summary = artwork ? toAgentArtworkSummary(artwork) : null;
    return {
      id: flag.artworkId,
      title: summary?.title ?? null,
      artist: summary?.artist ?? null,
      by: flag.by,
      ...(flag.reason ? { reason: flag.reason } : {}),
      onBoard: boardOrder.includes(flag.artworkId),
    };
  };

  const all = [...hung, ...filed];
  return {
    picks: all.filter((f) => f.flag === 'pick' && !f.provisional).map(describe),
    rejects: all
      .filter((f) => f.flag === 'reject' && !f.provisional)
      .map(describe),
    provisional: all.filter((f) => f.provisional).map(describe),
    exemplars: getExemplars(),
    hint: 'picks and rejects are confirmed by the human and are what redeal runs on. provisional are your own flags, still dashed on screen and not counted — do not read them back as the human’s taste.',
  };
};

const getViewContextTool = (context: ToolContext): WebMcpTool => ({
  name: 'get_view_context',
  title: 'Get view context',
  description:
    'Read what the human is looking at right now, and what they have done to it: the route, the collection, the query their own search box committed, the result set on screen, any artwork opened on the shared canvas — and the gesture state that matters more than any of it. `flags` is what they have picked and rejected, `board` is the current deal, `selection` and `hovered` are what "this" and "these" refer to.\nCall this before answering "what is this?", "find more like these", or anything that depends on the screen — and call it before you argue with someone, because the flags are the evidence. The result set is observed from the page\'s own search responses, so it is what is genuinely on screen, not a re-run of the query.',
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
      // The gesture half of the shared state. Everything below this line is
      // something the human did with their hands rather than said in words,
      // and when the two disagree, this is the half that is true.
      flags: describeFlags(state.board?.order ?? []),
      board: state.board
        ? {
            order: state.board.order,
            works: sampleResults(
              recallArtworks(state.board.order).found.map(toAgentArtworkSummary)
            ),
            note: state.board.note,
            lastChangeBy: state.board.lastChangeBy,
            redeals: state.board.redeals,
            dealtThisSession: state.board.dealt.length,
            hint: 'redeal deals from the confirmed flags with picks held in place. dealtThisSession is excluded from the next deal, so the loop keeps moving.',
          }
        : null,
      selection: state.selection.map((id) => ({
        id,
        work: flagLabel(id),
      })),
      hovered: state.hovered
        ? { id: state.hovered, work: flagLabel(state.hovered) }
        : null,
      compare: state.compare
        ? {
            artworkIds: state.compare.artworkIds,
            works: state.compare.artworkIds.map((id) => flagLabel(id)),
            question: state.compare.question,
            askedBy: state.compare.askedBy,
            resolved: false,
          }
        : null,
      // A deal that failed is worth more to the agent than silence: it is the
      // one thing on this page a human cannot fix by pointing at something.
      ...(state.dealError
        ? {
            lastDealFailed: {
              ...state.dealError,
              hint: 'The board is unchanged and the flags are intact. Say so in one sentence rather than immediately dealing again.',
            },
          }
        : {}),
      ...(state.dealing ? { dealing: true } : {}),
      // The human can index their own zip on /try without saying a word to the
      // agent. Reporting the job here is how the agent finds out.
      indexedCollection: state.indexJob
        ? {
            jobId: state.indexJob.jobId,
            collectionId: state.indexJob.collectionId,
            collectionName: state.indexJob.collectionName,
            startedBy: state.indexJob.origin,
            source: state.indexJob.source,
            startedAt: new Date(state.indexJob.at).toISOString(),
            hint:
              state.indexJob.origin === 'human'
                ? 'The human built this from their own files on this page. Call get_index_status with this jobId to read its progress, or pass a "query" to search what they just indexed.'
                : 'You started this job. Call get_index_status with this jobId for progress, or pass a "query" to search it.',
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
        maxLength: 160,
        description:
          'The wall label above the set: one sentence, naming the through-line. "The four with the storm-lit horizon." Not a paragraph, not a list of what you ruled out, and never a description of what you just did.',
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
      const target = resolveSearchTarget(
        (input as { collection?: unknown }).collection
      );
      const collectionId = target.collectionId;
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
        // Pin survival, enforced here rather than asked for.
        //
        // `redeal` cannot drop a confirmed pick, but an agent assembling a
        // board by hand could simply leave one out — and a curated set that
        // silently discards a work the human kept is exactly the failure the
        // whole flag mechanism exists to prevent. So anything they picked and
        // the agent omitted is added back, and the result says so.
        const held = getPinnedIds().filter(
          (id) => !rawIds.includes(id) && Boolean(recallArtwork(id))
        );
        const { found, missing } = recallArtworks([...rawIds, ...held]);
        if (!found.length) {
          return fail(
            'ARTWORK_NOT_IN_SESSION',
            'None of those ids have been loaded by this page.',
            'Search first, then pin ids from the results.'
          );
        }
        const order = found.map((artwork) => artwork.id);
        setAgentResults({
          origin: 'agent',
          label: note || `${found.length} works selected by the agent`,
          ...(note ? { note } : {}),
          items: found.map(toAgentArtworkSummary),
          at: Date.now(),
        });
        // Whatever is on the canvas *is* the board. Without this the human
        // sees a hang while get_view_context reports no board at all, and a
        // redeal after it would deal from nothing.
        const previousBoard = getWebMcpState().board;
        setBoard({
          order,
          dealt: [...new Set([...(previousBoard?.dealt ?? []), ...order])],
          note: note || null,
          lastChangeBy: 'agent',
          redeals: previousBoard?.redeals ?? 0,
          at: Date.now(),
        });
        outcome.pinned = found.length;
        if (held.length) {
          outcome.heldPicks = held.map((id) => ({ id, work: flagLabel(id) }));
          outcome.heldPicksNote =
            'These are the human’s confirmed picks. You left them out; they were put back. Build around them rather than replacing them.';
        }
        if (missing.length) outcome.unresolved = missing;
      }

      if (query || colour) {
        if (target.kind === 'indexed') {
          // A collection built on this page has no URL-driven search page to
          // navigate to — it lives in this tab, and navigating away would
          // discard it. Run the search and push it onto the shared canvas,
          // which is what /try renders.
          const response = await searchIndexedCollection(target.jobId, query, {
            topK: 30,
          });
          const artworks = response.results.map((result) =>
            toIndexedArtwork(
              result,
              response.collectionId,
              target.collectionName
            )
          );
          rememberArtworks(artworks);
          setAgentResults({
            origin: 'agent',
            label: note || `search “${query}” in ${target.collectionName}`,
            ...(note ? { note } : {}),
            items: artworks.map(toAgentArtworkSummary),
            at: Date.now(),
          });
          outcome.searched = query;
          outcome.shown = artworks.length;
          outcome.humanGrid = `The human’s grid on this page is now showing ${artworks.length} results from the collection they indexed here.`;
        } else {
          const params = new URLSearchParams();
          if (query) params.set('q', query);
          if (facet === 'artist' || facet === 'classification') {
            params.set('field', facet);
          }
          if (colour) params.set('colour', colour.selection);
          const destination = `${searchPathFor(collectionId)}?${params.toString()}`;
          // Client-side navigation: the search page is URL-driven, so this is
          // the same code path as the human typing in the box.
          context.navigate(destination);
          outcome.navigatedTo = destination;
          outcome.humanGrid =
            'The human’s grid is now running this search. Their results will differ from a topK-limited tool call — the page uses its own paging.';
        }
      }

      return ok({
        ...outcome,
        ...(note ? { note } : {}),
        effect: 'The human’s screen now reflects this.',
      });
    }),
});

const setViewTool = (): WebMcpTool => ({
  name: 'set_view',
  title: 'Change how the results are laid out',
  description:
    "Choose how the human's grid is arranged. Presentation is part of an answer: a cross-section you assembled from several different searches reads as a constellation in `atlas`, a hang reads as `salon`, a comparison of catalogue fields reads as `table`, and ordinary browsing reads as `masonry`. Set it when the shape of your answer is not an ordinary result list — otherwise leave the human's own choice alone.",
  // Not readOnly: it changes what a person is looking at. It stores nothing and
  // is trivially reversible by the human, so it needs no confirmation.
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: 'object',
    properties: {
      view: {
        type: 'string',
        enum: ['masonry', 'salon', 'atlas', 'table'],
        description:
          'masonry: the default grid. salon: a dense hang, good for a curated set. atlas: works positioned by visual similarity, good for showing how a cross-section relates. table: catalogue fields side by side.',
      },
    },
    required: ['view'],
    additionalProperties: false,
  },
  execute: async (input) =>
    guard(async () => {
      const view = asString((input as { view?: unknown }).view);
      const allowed = ['masonry', 'salon', 'atlas', 'table'] as const;
      if (!(allowed as readonly string[]).includes(view)) {
        return fail(
          'INVALID_INPUT',
          `view must be one of ${allowed.join(', ')}.`
        );
      }
      setCanvasView(view as (typeof allowed)[number]);
      return ok({
        view,
        effect: 'The human’s grid is now laid out this way.',
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
// Tier 1.6 — the culling loop: flag, deal, compare
//
// These are the tools that make this a shared workspace rather than a page an
// agent can drive. Each one is the agent's half of a gesture the human already
// has a key for, and both halves land in the same state.
// ---------------------------------------------------------------------------

/** An agent proposing more than a handful of judgements at once is guessing. */
const MAX_AGENT_FLAGS_PER_CALL = 3;

const flagLabel = (artworkId: string) => {
  const artwork = recallArtwork(artworkId);
  if (!artwork) return artworkId;
  const summary = toAgentArtworkSummary(artwork);
  return summary.artist ? `${summary.title} — ${summary.artist}` : summary.title;
};

const flagArtworksTool = (): WebMcpTool => ({
  name: 'flag_artworks',
  title: 'Flag works as picks or rejects',
  description:
    'Flag works in the same currency the human uses: pick, reject, or clear. This is how you *disagree* — if their words point one way and their flags point another, say so and flag what you actually think.\nYour flags land as provisional and are drawn dashed until the human confirms them by pressing P or X on the same work. They do not move the exemplars the deterministic redeal runs on; only confirmed flags do. So flagging is a proposal, not a decision, and you cannot overwrite someone\'s judgement by accident.\nAt most three per call, and always give a reason — a flag without one tells the human nothing.',
  // Not readOnly: badges appear on the human's cards.
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: 'object',
    properties: {
      flags: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_AGENT_FLAGS_PER_CALL,
        description:
          'Up to three flags. Fewer, with better reasons, is better than more.',
        items: {
          type: 'object',
          properties: {
            artworkId: {
              type: 'string',
              description: 'Id from any previous search, board, or view context.',
            },
            flag: {
              type: 'string',
              enum: ['pick', 'reject', 'clear'],
              description:
                'pick: worth keeping. reject: worth pushing away — this steers the redeal hardest, because one strong reject moves a whole visual region. clear: withdraw a flag you set.',
            },
            reason: {
              type: 'string',
              maxLength: 200,
              description:
                'One line, written for the human, naming what you saw: "the only one where the horizon is doing the work".',
            },
          },
          required: ['artworkId', 'flag'],
          additionalProperties: false,
        },
      },
    },
    required: ['flags'],
    additionalProperties: false,
  },
  execute: async (input) =>
    guard(async () => {
      const raw = (input as { flags?: unknown }).flags;
      if (!Array.isArray(raw) || raw.length === 0) {
        return fail('INVALID_INPUT', 'flags must be a non-empty array.');
      }
      if (raw.length > MAX_AGENT_FLAGS_PER_CALL) {
        return fail(
          'TOO_MANY_FLAGS',
          `At most ${MAX_AGENT_FLAGS_PER_CALL} flags per call.`,
          'Flag the few you are most confident about, then read the human’s reaction before flagging more.'
        );
      }

      const applied: Record<string, unknown>[] = [];
      const unresolved: string[] = [];

      for (const entry of raw) {
        const artworkId = asString((entry as { artworkId?: unknown })?.artworkId);
        const flag = asString((entry as { flag?: unknown })?.flag);
        const reason = asString((entry as { reason?: unknown })?.reason);

        if (!artworkId || !['pick', 'reject', 'clear'].includes(flag)) {
          return fail(
            'INVALID_INPUT',
            'Each flag needs an artworkId and a flag of pick, reject, or clear.'
          );
        }
        if (!recallArtwork(artworkId)) {
          unresolved.push(artworkId);
          continue;
        }
        const change = setFlag(artworkId, flag as FlagIntent, {
          by: 'agent',
          ...(reason ? { reason } : {}),
        });
        if (change) {
          applied.push({
            artworkId,
            work: flagLabel(artworkId),
            flag: change.to,
            ...(reason ? { reason } : {}),
          });
        }
      }

      if (!applied.length && unresolved.length) {
        return fail(
          'ARTWORK_NOT_IN_SESSION',
          'None of those ids have been loaded by this page.',
          'Search or read get_view_context first, then flag ids from what came back.'
        );
      }

      const exemplars = getExemplars();
      return ok({
        applied,
        ...(unresolved.length ? { unresolved } : {}),
        provisional: true,
        confirmedExemplars: exemplars,
        effect:
          'These are on the human’s cards as dashed proposals. They will not steer a redeal until the human confirms them.',
      });
    }),
});

const searchByExemplarsTool = (): WebMcpTool => ({
  name: 'search_by_exemplars',
  title: 'Search by example',
  description:
    'Find works that look like the ones someone kept and unlike the ones they threw out. Scored server-side over the same visual embeddings the image search uses:\n  score = cos(x, mean(positives)) − 0.5 · max(cos(x, each negative))\nThe negative term takes the worst single match rather than an average, so one emphatic rejection genuinely pushes a whole region of the collection away instead of being diluted by milder ones.\nThis is the engine under `redeal`. Call it directly when you want candidates to reason about without changing what is on the human\'s screen; call `redeal` when you want to actually deal a new board.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      positiveIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 32,
        description:
          'Works to move toward. Their average is the query. Ids from any previous result.',
      },
      negativeIds: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 32,
        description:
          'Works to move away from. One well-chosen rejection does more here than three vague ones.',
      },
      excludeIds: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 400,
        description:
          'Ids to leave out of the results — normally everything already dealt this session, so the loop keeps moving instead of returning the same works.',
      },
      topK: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        default: 12,
        description:
          'How many to return. The board holds 12, so 12 is the useful default.',
      },
      collection: collectionProperty,
    },
    required: ['positiveIds'],
    additionalProperties: false,
  },
  execute: async (input, options) =>
    guard(async () => {
      const positiveIds = readStringArray(
        (input as { positiveIds?: unknown }).positiveIds
      );
      if (!positiveIds.length) {
        return fail(
          'INVALID_INPUT',
          'positiveIds must contain at least one artwork id.',
          'Read get_view_context for what the human has picked, or pass ids from a search you just ran.'
        );
      }
      const target = resolveSearchTarget(
        (input as { collection?: unknown }).collection
      );
      if (target.kind === 'indexed') {
        return fail(
          'EXEMPLAR_SEARCH_UNAVAILABLE_HERE',
          'Exemplar search runs against the published vector index; this page is scoped to a collection built in this tab.',
          'Name a public collection, or use search_by_image with one artworkId instead.'
        );
      }

      // Fail on ids this page has never seen, the way every other tool here
      // does, rather than spending a round trip on a query the server will
      // refuse. A positive the page cannot resolve is almost always a model
      // inventing an id, and silently averaging the rest would answer a
      // question nobody asked.
      const knownPositives = positiveIds.filter((id) => Boolean(recallArtwork(id)));
      const unresolved = positiveIds.filter((id) => !recallArtwork(id));
      if (!knownPositives.length) {
        return fail(
          'ARTWORK_NOT_IN_SESSION',
          `None of those ids have been loaded by this page: ${positiveIds.join(', ')}.`,
          'Ids are only resolvable within this browsing session. Run a search, or read get_view_context for what is already on screen.'
        );
      }

      const response = await searchByExemplarsPublic({
        collectionId: target.collectionId,
        positiveIds: knownPositives,
        negativeIds: readStringArray(
          (input as { negativeIds?: unknown }).negativeIds
        ),
        excludeIds: readStringArray(
          (input as { excludeIds?: unknown }).excludeIds
        ),
        topK: clampInt((input as { topK?: unknown }).topK, 1, 100, 12),
        signal: options.signal,
      });

      return ok({
        collection: target.collectionId,
        count: response.results.length,
        scoring:
          'cos(x, mean(positives)) − 0.5 · max over negatives. Fixed weights, nothing learned; the same exemplars always return the same works.',
        results: capture(response.results),
        ...(unresolved.length
          ? {
              unresolved,
              unresolvedHint:
                'These ids are not on this page and were left out of the average. Check them before using them again.',
            }
          : {}),
        next: 'Call redeal to put a set like this on the board with the human’s picks held in place, or set_results to pin a chosen subset.',
      });
    }),
});

const redealTool = (): WebMcpTool => ({
  name: 'redeal',
  title: 'Deal a new board from the flags',
  description:
    'Rearrange the board from what has been picked and rejected. Picks stay exactly where they are, rejects leave, and newcomers fill the gaps — twelve cards, so every move is legible.\nThis is the same function the human runs by pressing Enter on an empty prompt bar. You are a second operator of it, not a layer above it: you add strategy and language, not the mechanism.\nPin survival is enforced here, not by your care — you have no argument that can drop a confirmed pick. Use `note` to say, in one line, what you are following and why; when the human\'s words and their flags disagree, this is where you name the disagreement.',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: {
    type: 'object',
    properties: {
      keep: {
        type: 'string',
        enum: ['picks'],
        description:
          'Only "picks", and it is the default and the only behaviour: confirmed picks always survive a redeal. Accepted so the intent can be stated explicitly.',
      },
      strategy: {
        type: 'string',
        enum: ['tighten', 'widen'],
        description:
          'tighten: weight the rejections harder (0.8) and take the nearest works — use when the picks already share something and you want more of exactly that. widen: weight rejections lightly (0.25) and skip the nearest band, so the board moves further from what is already hung — use when the loop has gone circular. Omit for the steady 0.5.',
      },
      count: {
        type: 'integer',
        minimum: 1,
        maximum: 60,
        default: 12,
        description:
          'How many cards to deal. Leave it at 12 unless the human asked for a different size; the loop is legible because the board is small.',
      },
      note: {
        type: 'string',
        maxLength: 160,
        description:
          'The wall label above the board: one sentence, naming what this deal follows. "You said warm; your picks are all cool. Following the picks." Not a paragraph.',
      },
      collection: collectionProperty,
    },
    additionalProperties: false,
  },
  execute: async (input, options) =>
    guard(async () => {
      const strategyInput = asString((input as { strategy?: unknown }).strategy);
      const strategy =
        strategyInput === 'tighten' || strategyInput === 'widen'
          ? strategyInput
          : undefined;
      const note = asString((input as { note?: unknown }).note);
      const countInput = (input as { count?: unknown }).count;

      const result = await runRedeal({
        by: 'agent',
        ...(strategy ? { strategy } : {}),
        ...(countInput === undefined
          ? {}
          : { count: clampInt(countInput, 1, 60, BOARD_SIZE) }),
        ...(note ? { note } : {}),
        collection: (input as { collection?: unknown }).collection,
        ...(options.signal ? { signal: options.signal } : {}),
      });

      if (!result.ok) {
        return fail(
          result.error.code,
          result.error.message,
          result.error.hint
        );
      }

      return ok({
        kept: result.kept.map((id) => ({ id, work: flagLabel(id) })),
        removed: result.removed.map((id) => ({ id, work: flagLabel(id) })),
        added: result.added.map((id) => ({ id, work: flagLabel(id) })),
        order: result.order,
        exemplars: result.exemplars,
        strategy: result.strategy,
        ...(result.note ? { note: result.note } : {}),
        effect:
          'The board on the human’s screen is now this, with their picks in the positions they were in.',
      });
    }),
});

const compareArtworksTool = (): WebMcpTool => ({
  name: 'compare_artworks',
  title: 'Put two works side by side',
  description:
    'Ask a question with pictures instead of words. Two works go up large on the human\'s screen with your question between them; they answer with one click.\nThis is the cheapest question you can ask a person who has taste but no vocabulary — "which of these two?" costs them a glance, where "do you prefer higher contrast or a softer tonal range?" costs them an essay they may not be able to write. Use it when you have a real hypothesis to test about what they are after, not to fill a turn.\nTheir click resolves as a pick on the winner and a reject on the loser, and comes back to you as a turn, so the answer lands in the exemplars whether or not they say anything.',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: 'object',
    properties: {
      artworkIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 2,
        description:
          'Exactly two ids, already loaded by this page. Choose a pair that differs on the one axis you are actually asking about.',
      },
      question: {
        type: 'string',
        maxLength: 200,
        description:
          'The question, set between the two works. Keep it answerable by pointing: "Which one belongs above a sofa?" not "Which do you prefer aesthetically?".',
      },
    },
    required: ['artworkIds'],
    additionalProperties: false,
  },
  execute: async (input) =>
    guard(async () => {
      const ids = readStringArray((input as { artworkIds?: unknown }).artworkIds);
      if (ids.length !== 2) {
        return fail(
          'INVALID_INPUT',
          'artworkIds must contain exactly two ids.',
          'Two-up is the point: a third work turns a choice back into a search.'
        );
      }
      const [first, second] = ids as [string, string];
      if (first === second) {
        return fail('INVALID_INPUT', 'The two ids must be different.');
      }

      const { found, missing } = recallArtworks(ids);
      if (missing.length) {
        return fail(
          'ARTWORK_NOT_IN_SESSION',
          `Not loaded by this page: ${missing.join(', ')}.`,
          'Search first, then compare ids from the results.'
        );
      }

      const question = asString((input as { question?: unknown }).question);
      setCompare({
        artworkIds: [first, second],
        question: question || null,
        askedBy: 'agent',
        at: Date.now(),
      });

      return ok({
        comparing: found.map((artwork) => toAgentArtworkSummary(artwork)),
        ...(question ? { question } : {}),
        effect:
          'Both works are on the human’s screen at full size with your question between them.',
        next: 'Wait for their click. It arrives as a turn carrying compareChoice, and resolves to a pick and a reject on its own.',
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

// ---------------------------------------------------------------------------
// Tier 3 — indexing: the agent brings its own images and makes them searchable
// ---------------------------------------------------------------------------

/**
 * Indexing is a *job*, not a call. A WebMCP `execute` must return in seconds
 * and hundreds of embeddings take minutes, so `index_zip`/`index_folder`
 * create the job, hand back `{jobId, collectionId}` and let the upload pump
 * run on in the page; `get_index_status` is the agent's window into it.
 *
 * That shape is what makes the last beat possible: the same `get_index_status`
 * call that reports `searchable: true` will, given a `query`, search the
 * collection the zip just became — so "index this" and "now find the blue one"
 * are one conversation, not two systems.
 */

/**
 * Anonymous indexing always lands in one sandbox organisation, enforced
 * server-side (`WEBMCP_INDEX_ORG_ID`). It is named here only so the job
 * carries no "you asked for somewhere else" notice; the agent is not offered a
 * choice because it does not have one.
 */
const INDEX_SANDBOX_ORG = 'webmcp-index';

/** How long a job of this size realistically takes to become searchable. */
const POLL_INTERVAL_MS = 2500;

/**
 * Measured on staging: `searchable: true` means "embedded", and Vectorize
 * needs roughly another 15s before a query returns those vectors. Told to the
 * agent, or it reports a working collection as empty.
 */
const VECTOR_LAG_SECONDS = 15;

/** Recovery advice per failure code, read by `guard`. */
const INDEXING_HINTS: Record<string, string> = {
  INVALID_ARCHIVE:
    'That was not a readable zip. Pass the archive as a data: URI if a remote URL is being rewritten in transit, or use index_folder for loose images.',
  NO_INDEXABLE_FILES: `Nothing in it was an indexable image (${INDEX_CAPS.imageTypes.join(', ')}). Check what you sent before retrying; a retry with the same input will fail the same way.`,
  INDEXING_RATE_LIMITED: `Only ${INDEX_CAPS.maxJobsPerHour} indexing jobs may be created per hour from one address. Tell the human rather than retrying in a loop.`,
  INDEXING_SANDBOX_FULL:
    'The shared indexing sandbox is full and an operator has to clear it. Nothing you can retry — say so plainly.',
  FILE_FETCH_BLOCKED:
    'The page could not read that URL cross-origin. A data: URI always works.',
  FILE_TOO_LARGE: `Per-image ceiling is ${Math.round(INDEX_CAPS.maxImageBytes / (1024 * 1024))} MB and one job may total ${Math.round(INDEX_CAPS.maxJobBytes / (1024 * 1024))} MB.`,
  NOT_FOUND:
    'No such indexing job. jobIds come from index_zip or index_folder and live on the server, not in this page.',
  INDEX_SEARCH_UNAVAILABLE:
    'Vector search is not configured on this deployment, so the indexed collection cannot be queried. The images are still indexed.',
  // describe_artwork shares this map: guard looks every PailletteApiError
  // code up here, so its failures carry a next step the same way.
  DESCRIBE_RATE_LIMITED:
    'This address has spent its hourly description budget. Tell the human, and lean on catalogue metadata and your own reading of the image instead of retrying.',
  DESCRIBE_UNAVAILABLE:
    'Assistive descriptions are not configured on this deployment right now. Say so plainly rather than retrying.',
  DESCRIBE_FAILED:
    'The description model could not be reached this time. One retry is reasonable; more is not.',
};

const timestampName = (prefix: string) =>
  `${prefix} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

/**
 * The host's signal is scoped to `execute`; the upload pump deliberately
 * outlives the call. So forward cancellation only while the call is in flight
 * — a host that tidies up its AbortController after `execute` resolves must
 * not silently kill a job the human is waiting on.
 */
const withCallScopedAbort = async <T>(
  signal: AbortSignal | undefined,
  run: (jobSignal: AbortSignal) => Promise<T>
): Promise<T> => {
  const controller = new AbortController();
  const forward = () => controller.abort();
  if (signal?.aborted) forward();
  else signal?.addEventListener('abort', forward, { once: true });
  try {
    return await run(controller.signal);
  } finally {
    signal?.removeEventListener('abort', forward);
  }
};

/** Consent for indexing reads the same way as create_collection's. */
const confirmIndexing = async (
  toolName: string,
  title: string,
  detail: string,
  signal?: AbortSignal
) => {
  const approved = await requestConfirmation({ toolName, title, detail, signal });
  return approved
    ? null
    : fail(
        'DECLINED_BY_USER',
        'The human declined this on the page.',
        'Do not retry without being asked to. Say what you were about to index and let them decide.'
      );
};

/** One shape for both index tools, so the agent learns the loop once. */
const indexJobStarted = (
  handle: IndexJobHandle,
  collectionName: string,
  source: 'zip' | 'files',
  extra: ToolResult = {}
): ToolResult => {
  // Record it on the shared canvas so the human's page can show the job the
  // agent just started, and so get_view_context can hand the jobId back later
  // in the conversation without the model having to have kept it.
  setIndexJob({
    jobId: handle.jobId,
    collectionId: handle.collectionId,
    collectionName,
    origin: 'agent',
    source,
    at: Date.now(),
  });

  return ok({
    jobId: handle.jobId,
    collectionId: handle.collectionId,
    collectionName,
    source,
    state: 'queued',
    ...extra,
    caps: INDEX_CAPS,
    storage: `Images are uploaded to Paillette's shared anonymous indexing sandbox ("${INDEX_SANDBOX_ORG}"). Nothing is written to the NGA catalogue, and anyone with the jobId can read this collection.`,
    poll: {
      tool: 'get_index_status',
      arguments: { jobId: handle.jobId },
      suggestedIntervalMs: POLL_INTERVAL_MS,
    },
    next: `Indexing is running in the background — this call did not wait for it. Poll get_index_status with jobId "${handle.jobId}" every ~${Math.round(POLL_INTERVAL_MS / 1000)}s until state is "complete". As soon as it reports searchable:true, pass a "query" to that same call to run semantic search over this collection; the ids it returns work with lookup_artwork, show_artwork and set_results, so you can put a freshly indexed image on the human's screen. Measured caveat: an image is queryable roughly ${VECTOR_LAG_SECONDS} seconds after it is embedded, so a search fired the instant searchable flips can legitimately return zero hits — that is propagation, not failure. Poll again and re-run the query rather than reporting the collection as empty.`,
  });
};

const indexZipTool = (): WebMcpTool => ({
  name: 'index_zip',
  title: 'Index a zip archive',
  description:
    'Turn a zip of images into a new, semantically searchable collection on this site. The archive is opened in the browser, each image is embedded in the same vector space as everything else Paillette indexes, and an optional CSV sidecar inside the zip (columns like filename, title, artist, year, medium) becomes catalogue metadata. Returns a jobId immediately — indexing keeps running after this call returns, so poll get_index_status rather than waiting. Use this when the human has an archive of their own images; use index_folder for a handful of loose files.',
  // Mutating: this uploads the human's images and creates a server-side
  // collection. Not destructive — it only ever adds — but it is a real write,
  // so it asks on the page first, exactly as create_collection does.
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: {
    type: 'object',
    properties: {
      zipUrl: {
        type: 'string',
        description:
          'Absolute https:// URL or a data: URI of a .zip archive, up to 120 MB. A data: URI always works, so encode an archive the human handed you rather than linking it; a remote URL must send CORS headers for this page to be allowed to read it. (Same affordance as search_by_image\'s imageUrl.)',
        examples: ['data:application/zip;base64,UEsDBBQ…'],
      },
      collectionName: {
        type: 'string',
        minLength: 1,
        maxLength: 80,
        description:
          'What to call the collection this archive becomes, e.g. "Studio scans 2024". Shown to the human and returned by get_index_status. Defaults to a timestamped name.',
      },
    },
    required: ['zipUrl'],
    additionalProperties: false,
  },
  execute: async (input, options) =>
    guard(async () => {
      const zipUrl = asString((input as { zipUrl?: unknown }).zipUrl);
      if (!zipUrl) {
        return fail(
          'INVALID_INPUT',
          'zipUrl must be an https:// URL or a data: URI of a .zip archive.'
        );
      }
      const collectionName =
        asString((input as { collectionName?: unknown }).collectionName).slice(
          0,
          80
        ) || timestampName('Indexed archive');

      const declined = await confirmIndexing(
        'index_zip',
        `Index a zip archive as “${collectionName}”?`,
        `Up to ${INDEX_CAPS.maxImagesPerJob} images are uploaded to this site's shared anonymous indexing sandbox and embedded for search. Nothing is written to the NGA catalogue.`,
        options.signal
      );
      if (declined) return declined;

      const archive = await loadAgentFile(zipUrl, {
        fallbackName: 'archive.zip',
        maxBytes: INDEX_ARCHIVE_MAX_BYTES,
        signal: options.signal,
      });

      const handle = await withCallScopedAbort(options.signal, (jobSignal) =>
        indexZip(archive, {
          collectionName,
          orgId: INDEX_SANDBOX_ORG,
          signal: jobSignal,
        })
      );

      return indexJobStarted(handle, collectionName, 'zip', {
        archive: { name: archive.name, bytes: archive.size },
      });
    }),
});

const indexFolderTool = (): WebMcpTool => ({
  name: 'index_folder',
  title: 'Index a list of images',
  description:
    'Turn a list of individual image files into a new, semantically searchable collection — the loose-files counterpart to index_zip, for when the human has a folder rather than an archive. Each file is fetched by the page, embedded in Paillette\'s own vector space, and titled from its filename unless you supply metadata. Returns a jobId immediately; indexing continues in the background and is read back with get_index_status.',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        minItems: 1,
        maxItems: 60,
        description: `The images to index, in order. Up to ${INDEX_CAPS.maxImagesPerJob} are accepted per job (${INDEX_CAPS.imageTypes.join(', ')}, ${Math.round(INDEX_CAPS.maxImageBytes / (1024 * 1024))} MB each); anything past that is reported as skipped by get_index_status rather than dropped in silence. A file this page cannot read is skipped and named in the result — the rest of the job still runs.`,
        items: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description:
                'Absolute https:// URL or data: URI of one image. A data: URI always works; a remote URL must send CORS headers.',
            },
            name: {
              type: 'string',
              maxLength: 200,
              description:
                'Filename including its extension, e.g. "wave-01.jpg". The extension decides the image type, and the name matches this file to a row in metadataCsv. Defaults to the URL\'s last path segment.',
            },
          },
          required: ['url'],
          additionalProperties: false,
        },
      },
      collectionName: {
        type: 'string',
        minLength: 1,
        maxLength: 80,
        description:
          'What to call the collection these files become. Defaults to a timestamped name.',
      },
      metadataCsv: {
        type: 'string',
        maxLength: 100000,
        description:
          'Optional CSV giving each file a real catalogue record instead of a filename-derived title. One row per image; a header naming any of filename, title, artist, year, medium, classification, description, credit_line, accession_number (common aliases such as creator, date and object type are understood). The filename column is matched case-insensitively against each file\'s name.',
      },
    },
    required: ['files'],
    additionalProperties: false,
  },
  execute: async (input, options) =>
    guard(async () => {
      const raw = Array.isArray((input as { files?: unknown }).files)
        ? ((input as { files: unknown[] }).files as unknown[])
        : [];
      const requested = raw
        .map((entry) => {
          const record = (entry ?? {}) as { url?: unknown; name?: unknown };
          return {
            url: asString(record.url),
            name: asString(record.name).slice(0, 200),
          };
        })
        .filter((entry) => entry.url);

      if (!requested.length) {
        return fail(
          'INVALID_INPUT',
          'files must contain at least one { url } entry.',
          'Each entry is an https:// URL or a data: URI of a single image.'
        );
      }

      const collectionName =
        asString((input as { collectionName?: unknown }).collectionName).slice(
          0,
          80
        ) || timestampName('Indexed files');
      const metadataCsv = asString(
        (input as { metadataCsv?: unknown }).metadataCsv
      );

      const declined = await confirmIndexing(
        'index_folder',
        `Index ${requested.length} file${requested.length === 1 ? '' : 's'} as “${collectionName}”?`,
        `They are uploaded to this site's shared anonymous indexing sandbox and embedded for search. Nothing is written to the NGA catalogue.`,
        options.signal
      );
      if (declined) return declined;

      const files: File[] = [];
      const unreadable: Array<{ url: string; message: string }> = [];
      for (const entry of requested) {
        try {
          files.push(
            await loadAgentFile(entry.url, {
              ...(entry.name ? { name: entry.name } : {}),
              fallbackName: `image-${files.length + 1}.jpg`,
              maxBytes: INDEX_FILE_MAX_BYTES,
              signal: options.signal,
            })
          );
        } catch (error) {
          if (isAbort(error)) throw error;
          // One unreadable URL is one lost image, not a lost job.
          unreadable.push({
            url: entry.url.slice(0, 120),
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (!files.length) {
        return fail(
          'NO_READABLE_FILES',
          `None of the ${requested.length} file(s) could be read by this page.`,
          `First failure: ${unreadable[0]?.message ?? 'unknown'}. data: URIs avoid cross-origin restrictions entirely.`
        );
      }

      if (metadataCsv) {
        // `indexFiles` already reads any .csv in the list as a sidecar, so the
        // agent's inline CSV rides the same path as one found in a folder.
        files.push(
          new File([metadataCsv], 'metadata.csv', { type: 'text/csv' })
        );
      }

      const handle = await withCallScopedAbort(options.signal, (jobSignal) =>
        indexFiles(files, {
          collectionName,
          orgId: INDEX_SANDBOX_ORG,
          signal: jobSignal,
        })
      );

      return indexJobStarted(handle, collectionName, 'files', {
        submitted: files.length - (metadataCsv ? 1 : 0),
        ...(metadataCsv ? { metadataCsvApplied: true } : {}),
        ...(unreadable.length ? { unreadable } : {}),
      });
    }),
});

const getIndexStatusTool = (): WebMcpTool => ({
  name: 'get_index_status',
  title: 'Get indexing status',
  description:
    'Read the progress of an indexing job started by index_zip or index_folder: state, how many images are processed out of the total, the collection it is building, and any per-file errors. Poll this rather than waiting — nothing blocks. It is also the way in: once it reports searchable:true (which happens as soon as the first image lands, before the job finishes), pass a "query" and this call runs semantic search over the collection the job just built and returns artwork records in the same shape as search_artworks — ids you can then hand to lookup_artwork, show_artwork or set_results. Once the job is done, the payload also carries `suggestions`: queries grounded in this collection\'s own catalogue metadata, or failing that its filenames, or failing that broad subject queries against the images — the same ones shown to the human on the page, so offer them rather than guessing a first query. `suggestions.source` says which.',
  // A pure read of job progress, like get_search_quota: it writes nothing, but
  // the answer changes between calls, so it is not idempotent.
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  inputSchema: {
    type: 'object',
    properties: {
      jobId: {
        type: 'string',
        minLength: 1,
        maxLength: 64,
        description: 'The jobId returned by index_zip or index_folder.',
      },
      query: {
        type: 'string',
        maxLength: 500,
        description:
          'Optional. When the job is searchable, also run this natural-language search over the collection it built and return the matches — the one call that takes you from "indexed" to "here are the results". Ignored (with a note) while the job has processed nothing yet.',
      },
      topK: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        default: 20,
        description:
          'How many matches to return when `query` is given. The route clamps this to 1-50.',
      },
    },
    required: ['jobId'],
    additionalProperties: false,
  },
  execute: async (input, options) =>
    guard(async () => {
      const jobId = asString((input as { jobId?: unknown }).jobId);
      if (!jobId) {
        return fail(
          'INVALID_INPUT',
          'jobId is required.',
          'It is returned by index_zip and index_folder.'
        );
      }
      const query = asString((input as { query?: unknown }).query);
      const status = await getIndexStatus(jobId, { signal: options.signal });
      const collectionName = status.collectionName ?? null;
      const searchable = status.searchable ?? status.processed > 0;
      const done = status.state === 'complete' || status.state === 'failed';
      const suggestions = getCollectionSuggestions(status);

      let search: ToolResult | null = null;
      if (query && searchable) {
        try {
          const response = await searchIndexedCollection(jobId, query, {
            topK: clampInt((input as { topK?: unknown }).topK, 1, 50, 20),
            signal: options.signal,
          });
          const artworks = response.results.map((result) =>
            toIndexedArtwork(
              result,
              response.collectionId,
              collectionName ?? 'Indexed collection'
            )
          );
          // Same session index as every other search, so show_artwork and
          // set_results resolve these ids without a second round trip.
          search = {
            query,
            count: artworks.length,
            results: capture(artworks),
            // The one case an agent reliably misreads: a job that is genuinely
            // working looks like an empty collection. The window does not close
            // when the job does — the last image is embedded about a second
            // before `complete`, so the lag straddles that transition and an
            // agent told "indexing finished" queries straight into it.
            ...(artworks.length === 0 && status.processed > 0
              ? {
                  note: done
                    ? `No hits yet, but all ${status.processed} images are embedded. Vectorize needs roughly ${VECTOR_LAG_SECONDS}s after the last image before it will return it, so a query this soon after completion can come back empty. Repeat it once before telling the human the collection is empty or that nothing matched.`
                    : `No hits yet. An image is queryable roughly ${VECTOR_LAG_SECONDS}s after it is embedded, and only ${status.processed} of ${status.total} are embedded so far — this is propagation lag, not an empty collection. Poll again and repeat the query before telling the human anything is wrong.`,
                }
              : {}),
          };
        } catch (cause) {
          // A failed search must not cost the agent its progress read: without
          // this, one 502 from the search route fails the whole status call.
          search = {
            query,
            count: 0,
            results: [],
            error: cause instanceof Error ? cause.message : String(cause),
            note: 'The search failed, but the indexing status above is accurate. Retry the query rather than reporting the job as broken.',
          };
        }
      }

      return ok({
        jobId: status.jobId,
        state: status.state,
        processed: status.processed,
        total: status.total,
        collectionId: status.collectionId,
        errors: status.errors.slice(0, 10),
        errorCount: status.errors.length,
        collectionName,
        failed: status.failed ?? 0,
        searchable,
        done,
        notice: status.notice ?? null,
        suggestions,
        ...(search ? { search } : {}),
        ...(query && !searchable
          ? {
              searchSkipped:
                'Nothing is embedded yet, so there is nothing to search. Poll again and repeat the query.',
            }
          : {}),
        next: done
          ? searchable
            ? `Indexing finished: ${status.processed} of ${status.total} images are in "${collectionName ?? status.collectionId}". ${
                suggestions?.suggestions.length
                  ? `Try one of \`suggestions\` (${suggestions.source === 'metadata' ? "grounded in this collection's catalogue metadata" : suggestions.source === 'filenames' ? 'derived from its filenames — it had no metadata sidecar' : 'broad subject queries — it had neither a metadata sidecar nor readable filenames'}), or call this tool again with your own "query".`
                  : 'Call this tool again with a "query" to search them.'
              } Then show_artwork or set_results to put one on the human's screen.`
            : 'The job finished without indexing anything. Read `errors` and `notice` and tell the human what went wrong rather than retrying blindly.'
          : `Still indexing (${status.processed}/${status.total}). Poll again in ~${Math.round(POLL_INTERVAL_MS / 1000)}s.${searchable ? ' Partial results are already searchable — you can pass a query now.' : ''}`,
      });
    }),
});

/**
 * The full surface, in the order a judge (or a model) should read it:
 * discovery, then the three search modalities, then browse and lookup, then
 * quota and description, then the shared canvas, then the gated mutations,
 * then indexing.
 */
export const createPailletteTools = (context: ToolContext): WebMcpTool[] => [
  listCollectionsTool(),
  searchArtworksTool(),
  searchByImageTool(),
  searchByColorTool(),
  browseCollectionTool(),
  lookupArtworkTool(),
  getSearchQuotaTool(),
  describeArtworkTool(),
  getViewContextTool(context),
  setResultsTool(context),
  showArtworkTool(),
  setViewTool(),
  flagArtworksTool(),
  searchByExemplarsTool(),
  redealTool(),
  compareArtworksTool(),
  createCollectionTool(),
  addToCollectionTool(),
  indexZipTool(),
  indexFolderTool(),
  getIndexStatusTool(),
];

export const PAILLETTE_TOOL_NAMES = [
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
  'set_view',
  'flag_artworks',
  'search_by_exemplars',
  'redeal',
  'compare_artworks',
  'create_collection',
  'add_to_collection',
  'index_zip',
  'index_folder',
  'get_index_status',
] as const;

export { NAMED_COLOURS };
