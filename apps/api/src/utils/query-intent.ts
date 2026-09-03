/**
 * LLM query intent for zip-indexed collections.
 *
 * NGA searches have a deterministic intent parser (`nga-search-intent.ts`).
 * User-indexed collections carry arbitrary metadata, so the same job is done
 * with one small LLM call: the natural-language query is mapped onto values
 * that actually exist in the collection — grounded in a D1 metadata
 * inventory — producing structured filters plus a rewritten semantic query.
 *
 * Every failure path returns null so the search route degrades to its
 * pre-intent behavior. This module must never break a search.
 */

import { openaiCompletion } from './openai';

export type QueryIntentFilters = {
  artist?: string;
  medium?: string;
  classification?: string;
  yearFrom?: number;
  yearTo?: number;
};

export type QueryIntent = {
  rewrittenQuery: string;
  filters: QueryIntentFilters;
  rationale: string;
};

/**
 * The interpretation surfaced for indexed collections, analogous to NGA's
 * `PublicSearchInterpretation`. The WebMCP search_artworks tool passes it
 * through unchanged as `interpretation`.
 */
export type IndexedSearchInterpretation = {
  parserVersion: 'llm-intent-v1';
  filters: QueryIntentFilters;
  rewrittenQuery: string;
  rationale: string;
};

export type CollectionMetadataInventory = {
  artists: Array<{ value: string; count: number }>;
  media: Array<{ value: string; count: number }>;
  classifications: Array<{ value: string; count: number }>;
  minYear: number | null;
  maxYear: number | null;
};

type QueryIntentEnv = {
  DB?: D1Database;
  CACHE?: KVNamespace;
  OPENAI_API_KEY?: string;
};

export type ResolveQueryIntentOptions = {
  collectionId: string;
  query: string;
  /** Pre-resolved inventory; fetched from D1 when omitted. */
  inventory?: CollectionMetadataInventory;
  signal?: AbortSignal;
  timeoutMs?: number;
};

const INTENT_CACHE_KEY_VERSION = 'v1';
const INTENT_CACHE_TTL_SECONDS = 60 * 60 * 24;
const INVENTORY_CACHE_KEY_VERSION = 'v1';
const INVENTORY_CACHE_TTL_SECONDS = 60 * 10;
const INVENTORY_FACET_LIMIT = 40;
const KV_READ_TIMEOUT_MS = 300;
const DEFAULT_INTENT_TIMEOUT_MS = 1500;
const MIN_INTENT_YEAR = -3000;
const MAX_FILTER_VALUE_LENGTH = 255;
const MAX_REWRITTEN_QUERY_LENGTH = 500;
const MAX_RATIONALE_LENGTH = 500;

const currentYear = () => new Date().getUTCFullYear();

const toHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

const sha256Hex = async (value: string) =>
  toHex(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

// ---------------------------------------------------------------------------
// Metadata inventory
// ---------------------------------------------------------------------------

/**
 * Distinct artist/medium/classification values with counts, plus the numeric
 * year range (`artworks.year`; `date_text` is free text and never numeric).
 * Scoped so either identifier the public search route resolves works: a
 * collection id matches its own items, the sandbox org id matches the whole
 * org. Each facet list is capped and ordered by frequency so the LLM prompt
 * stays small and the dominant values of the collection win.
 */
export const getCollectionMetadataInventory = async (
  db: D1Database,
  collectionId: string
): Promise<CollectionMetadataInventory | null> => {
  try {
    const inventoryFacetSql = (column: 'artist' | 'medium' | 'classification') =>
      `
      SELECT MIN(trim(${column})) AS value, COUNT(*) AS count
      FROM artworks
      WHERE deleted_at IS NULL
        AND (collection_id = ? OR org_id = ?)
        AND ${column} IS NOT NULL
        AND trim(${column}) <> ''
      GROUP BY lower(trim(${column}))
      ORDER BY count DESC, value ASC
      LIMIT ${INVENTORY_FACET_LIMIT}
    `;

    const sanitizeFacet = (
      rows: Array<{ value: string; count: number }>
    ): Array<{ value: string; count: number }> =>
      rows
        .filter(
          (row) =>
            typeof row?.value === 'string' &&
            row.value.trim() !== '' &&
            Number.isFinite(row?.count)
        )
        .map((row) => ({ value: row.value.trim(), count: row.count }));

    const [artists, media, classifications, years] = await Promise.all([
      db
        .prepare(inventoryFacetSql('artist'))
        .bind(collectionId, collectionId)
        .all<{ value: string; count: number }>(),
      db
        .prepare(inventoryFacetSql('medium'))
        .bind(collectionId, collectionId)
        .all<{ value: string; count: number }>(),
      db
        .prepare(inventoryFacetSql('classification'))
        .bind(collectionId, collectionId)
        .all<{ value: string; count: number }>(),
      db
        .prepare(
          `
          SELECT MIN(year) AS min_year, MAX(year) AS max_year
          FROM artworks
          WHERE deleted_at IS NULL
            AND (collection_id = ? OR org_id = ?)
            AND year IS NOT NULL
        `
        )
        .bind(collectionId, collectionId)
        .first<{ min_year: number | null; max_year: number | null }>(),
    ]);

    return {
      artists: sanitizeFacet(artists.results),
      media: sanitizeFacet(media.results),
      classifications: sanitizeFacet(classifications.results),
      minYear:
        typeof years?.min_year === 'number' && Number.isFinite(years.min_year)
          ? years.min_year
          : null,
      maxYear:
        typeof years?.max_year === 'number' && Number.isFinite(years.max_year)
          ? years.max_year
          : null,
    };
  } catch {
    return null;
  }
};

const isInventoryShape = (value: unknown): value is CollectionMetadataInventory => {
  if (!isRecord(value)) return false;
  for (const key of ['artists', 'media', 'classifications'] as const) {
    const entries = value[key];
    if (!Array.isArray(entries)) return false;
    if (
      entries.some(
        (entry) =>
          !isRecord(entry) ||
          typeof entry.value !== 'string' ||
          typeof entry.count !== 'number'
      )
    ) {
      return false;
    }
  }
  for (const key of ['minYear', 'maxYear'] as const) {
    if (value[key] !== null && typeof value[key] !== 'number') return false;
  }
  return true;
};

/** Inventory reads sit on the search path, so cache them in KV for 10 minutes. */
const getInventoryWithCache = async (
  env: QueryIntentEnv,
  collectionId: string
): Promise<CollectionMetadataInventory | null> => {
  const cacheKey = `query-intent-inventory:${INVENTORY_CACHE_KEY_VERSION}:${collectionId}`;
  if (env.CACHE) {
    try {
      const cached = await env.CACHE.get<unknown>(cacheKey, 'json');
      if (isInventoryShape(cached)) return cached;
    } catch {
      // Fall through and recompute.
    }
  }

  if (!env.DB) return null;
  const inventory = await getCollectionMetadataInventory(env.DB, collectionId);

  if (inventory && env.CACHE) {
    try {
      await env.CACHE.put(cacheKey, JSON.stringify(inventory), {
        expirationTtl: INVENTORY_CACHE_TTL_SECONDS,
      });
    } catch {
      // Best-effort cache; the next read just recomputes.
    }
  }

  return inventory;
};

const inventoryHasGroundingSignals = (inventory: CollectionMetadataInventory) =>
  inventory.artists.length > 0 ||
  inventory.media.length > 0 ||
  inventory.classifications.length > 0 ||
  inventory.minYear !== null ||
  inventory.maxYear !== null;

// ---------------------------------------------------------------------------
// Intent resolution
// ---------------------------------------------------------------------------

const INTENT_SYSTEM_PROMPT = `You interpret one artwork search query against one image collection, using only that collection's own metadata inventory.

Answer with ONLY a JSON object of this exact shape:
{"rewrittenQuery": string, "filters": {}, "rationale": string}

"filters" may contain at most these optional keys:
- "artist": an artist copied VERBATIM from inventory.artists
- "medium": a medium copied VERBATIM from inventory.media
- "classification": a classification copied VERBATIM from inventory.classifications
- "yearFrom": integer, the first year the query confines results to
- "yearTo": integer, the last year the query confines results to

Hard rules:
- Never invent artist, medium, or classification names. A filter value must be copied exactly from the inventory, or that filter must be omitted.
- Set yearFrom/yearTo only when the query constrains dates (a year, a decade, a century, "before 1800").
- When nothing in the query constrains metadata, return "filters" as {} and "rewrittenQuery" as the query unchanged.
- "rewrittenQuery" keeps the query's visual and subject wording, dropping only the words already captured as filters.
- "rationale" is one short sentence stating what was extracted.`;

const buildIntentMessages = (
  query: string,
  inventory: CollectionMetadataInventory
) => [
  { role: 'system' as const, content: INTENT_SYSTEM_PROMPT },
  {
    role: 'user' as const,
    content: JSON.stringify({
      query,
      inventory: {
        artists: inventory.artists.map((entry) => entry.value),
        media: inventory.media.map((entry) => entry.value),
        classifications: inventory.classifications.map((entry) => entry.value),
        yearRange:
          inventory.minYear !== null || inventory.maxYear !== null
            ? { from: inventory.minYear, to: inventory.maxYear }
            : null,
      },
    }),
  },
];

const coerceBoundedText = (value: unknown, maxLength: number) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
};

const isGroundedInInventory = (
  value: string,
  entries: Array<{ value: string; count: number }>
) => entries.some((entry) => entry.value.toLowerCase() === value.toLowerCase());

const coerceIntentYear = (value: unknown) => {
  const year =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value.trim())
        : NaN;
  if (!Number.isInteger(year)) return null;
  if (year < MIN_INTENT_YEAR || year > currentYear()) return null;
  return year;
};

/**
 * Trust nothing the model returns: unknown or empty values are dropped,
 * facet filters must be grounded in the inventory verbatim, and years are
 * coerced into a sane range with `yearFrom < yearTo` required when both are
 * present. Always returns a usable intent — the original query unchanged and
 * empty filters is a valid outcome.
 */
const coerceQueryIntent = (
  completion: unknown,
  originalQuery: string,
  inventory: CollectionMetadataInventory
): QueryIntent => {
  const source = isRecord(completion) ? completion : {};
  const rawFilters = isRecord(source.filters) ? source.filters : {};
  const filters: QueryIntentFilters = {};

  const artist = coerceBoundedText(rawFilters.artist, MAX_FILTER_VALUE_LENGTH);
  if (artist && isGroundedInInventory(artist, inventory.artists)) {
    filters.artist = artist;
  }
  const medium = coerceBoundedText(rawFilters.medium, MAX_FILTER_VALUE_LENGTH);
  if (medium && isGroundedInInventory(medium, inventory.media)) {
    filters.medium = medium;
  }
  const classification = coerceBoundedText(
    rawFilters.classification,
    MAX_FILTER_VALUE_LENGTH
  );
  if (
    classification &&
    isGroundedInInventory(classification, inventory.classifications)
  ) {
    filters.classification = classification;
  }

  const yearFrom = coerceIntentYear(rawFilters.yearFrom);
  const yearTo = coerceIntentYear(rawFilters.yearTo);
  if (yearFrom !== null && yearTo !== null) {
    if (yearFrom < yearTo) {
      filters.yearFrom = yearFrom;
      filters.yearTo = yearTo;
    }
  } else {
    if (yearFrom !== null) filters.yearFrom = yearFrom;
    if (yearTo !== null) filters.yearTo = yearTo;
  }

  return {
    rewrittenQuery:
      coerceBoundedText(source.rewrittenQuery, MAX_REWRITTEN_QUERY_LENGTH) ||
      originalQuery,
    filters,
    rationale: coerceBoundedText(source.rationale, MAX_RATIONALE_LENGTH) ?? '',
  };
};

// ---------------------------------------------------------------------------
// KV intent cache — identical repeat queries cost nothing
// ---------------------------------------------------------------------------

const intentCacheKey = async (collectionId: string, query: string) =>
  `query-intent:${INTENT_CACHE_KEY_VERSION}:${await sha256Hex(
    `${collectionId}\u0000${query}`
  )}`;

const isQueryIntentShape = (value: unknown): value is QueryIntent => {
  if (!isRecord(value) || typeof value.rewrittenQuery !== 'string') {
    return false;
  }
  if (typeof value.rationale !== 'string' || !isRecord(value.filters)) {
    return false;
  }
  for (const key of ['artist', 'medium', 'classification'] as const) {
    const filter = value.filters[key];
    if (filter !== undefined && typeof filter !== 'string') return false;
  }
  for (const key of ['yearFrom', 'yearTo'] as const) {
    const filter = value.filters[key];
    if (filter !== undefined && typeof filter !== 'number') return false;
  }
  return true;
};

const readCachedIntent = async (
  cache: KVNamespace | undefined,
  collectionId: string,
  query: string
): Promise<QueryIntent | null> => {
  if (!cache) return null;

  try {
    const key = await intentCacheKey(collectionId, query);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const cached = await Promise.race([
      cache.get<unknown>(key, 'json'),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), KV_READ_TIMEOUT_MS);
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
    return isQueryIntentShape(cached) ? cached : null;
  } catch {
    return null;
  }
};

const writeCachedIntent = async (
  cache: KVNamespace | undefined,
  collectionId: string,
  query: string,
  intent: QueryIntent
) => {
  if (!cache) return;

  try {
    await cache.put(await intentCacheKey(collectionId, query), JSON.stringify(intent), {
      expirationTtl: INTENT_CACHE_TTL_SECONDS,
    });
  } catch {
    // Best-effort; a cache miss just repeats the LLM call.
  }
};

/**
 * Resolve the query intent for one indexed collection, or null when the
 * feature is unavailable (no API key, no inventory, LLM failure, timeout).
 * The whole pipeline runs under a hard deadline so a search never waits on
 * the LLM for more than ~1.5s; a timed-out resolution keeps running in the
 * background and may still warm the KV cache.
 */
export const resolveQueryIntent = async (
  env: QueryIntentEnv,
  options: ResolveQueryIntentOptions
): Promise<QueryIntent | null> => {
  const query = options.query.trim();
  if (!query || !options.collectionId || !env.OPENAI_API_KEY) {
    return null;
  }

  const controller = new AbortController();
  const abortFromCaller = () =>
    controller.abort(options.signal?.reason ?? new Error('Query intent aborted'));
  if (options.signal?.aborted) abortFromCaller();
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new Error('Query intent resolution timed out'));
      resolve(null);
    }, options.timeoutMs ?? DEFAULT_INTENT_TIMEOUT_MS);
  });

  const run = (async (): Promise<QueryIntent | null> => {
    const cached = await readCachedIntent(
      env.CACHE,
      options.collectionId,
      query
    );
    if (cached) return cached;

    const inventory =
      options.inventory ??
      (await getInventoryWithCache(env, options.collectionId));
    if (!inventory || !inventoryHasGroundingSignals(inventory)) return null;

    const completion = await openaiCompletion({
      env,
      messages: buildIntentMessages(query, inventory),
      json: true,
      maxTokens: 300,
      signal: controller.signal,
    });
    const intent = coerceQueryIntent(completion, query, inventory);
    await writeCachedIntent(env.CACHE, options.collectionId, query, intent);
    return intent;
  })();

  try {
    return await Promise.race([run, deadline]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortFromCaller);
    // When the deadline won, the loser must not surface an unhandled rejection.
    void run.catch(() => undefined);
  }
};

// ---------------------------------------------------------------------------
// Post-filtering
// ---------------------------------------------------------------------------

export type IntentFilterableArtwork = {
  artist?: string | null;
  year?: number | null;
  metadata?: Record<string, unknown> | null;
};

const normalizeFacetText = (value: string) =>
  value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Same case-insensitive semantics as the route's facet searches: artist and
 * medium match by normalized phrase containment (the artist facet's LIKE),
 * classification by normalized equality (the classification facet's exact
 * match), and the year range against the numeric year. Artworks without a
 * year never satisfy a year range.
 */
export const artworkMatchesIntentFilters = (
  artwork: IntentFilterableArtwork,
  filters: QueryIntentFilters
): boolean => {
  if (filters.artist) {
    const artworkArtist = normalizeFacetText(String(artwork.artist ?? ''));
    if (!artworkArtist.includes(normalizeFacetText(filters.artist))) {
      return false;
    }
  }
  if (filters.medium) {
    const artworkMedium = normalizeFacetText(
      String(artwork.metadata?.medium ?? '')
    );
    if (!artworkMedium.includes(normalizeFacetText(filters.medium))) {
      return false;
    }
  }
  if (filters.classification) {
    const artworkClassification = normalizeFacetText(
      String(artwork.metadata?.classification ?? '')
    );
    if (artworkClassification !== normalizeFacetText(filters.classification)) {
      return false;
    }
  }
  if (filters.yearFrom !== undefined || filters.yearTo !== undefined) {
    const year = typeof artwork.year === 'number' ? artwork.year : null;
    if (year === null) return false;
    if (filters.yearFrom !== undefined && year < filters.yearFrom) return false;
    if (filters.yearTo !== undefined && year > filters.yearTo) return false;
  }
  return true;
};
