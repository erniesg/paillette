/**
 * WebMCP indexing routes — `index_zip` / `index_folder` / `get_index_status`.
 *
 * A WebMCP tool's `execute` must return quickly with JSON, and a Worker cannot
 * hold a large archive in memory or exceed its subrequest budget. So indexing
 * is modelled as a job the browser drives:
 *
 *   1. POST /public-index/jobs            create job + collection, plan caps
 *   2. POST /public-index/jobs/:id/items  push a small batch of images
 *   3. POST /public-index/jobs/:id/complete
 *   4. GET  /public-index/jobs/:id        pollable status
 *   5. POST /public-index/jobs/:id/search search the collection just built
 *
 * The zip itself is parsed in the browser (see apps/web/app/lib/indexing-client.ts);
 * this Worker only ever sees a handful of already-extracted images per request.
 *
 * AUTHENTICATION: these routes are deliberately anonymous. The demo runs in
 * ChatGPT's in-app browser with no account, mirroring the existing anonymous
 * NGA artwork reads. Every write is confined to one sandbox organisation and
 * bounded by the caps below; nothing here can read or mutate NGA/NGS data.
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import { uploadImage } from '../utils/r2';
import {
  getCollectionMetadataInventory,
  resolveQueryIntent,
  artworkMatchesIntentFilters,
  type QueryIntent,
  type QueryIntentFilters,
} from '../utils/query-intent';
import { generateJinaQueryEmbedding } from './search';
import { openaiCompletion } from '../utils/openai';

// ---------------------------------------------------------------------------
// Sandbox scope + caps
// ---------------------------------------------------------------------------

/** Seeded by migration 0021. Anonymous indexing may write nowhere else. */
export const WEBMCP_INDEX_ORG_ID = 'f2b7c1a4-9d3e-4b8c-a1f6-2e5d7c9b4a30';
export const WEBMCP_INDEX_ORG_SLUG = 'webmcp-index';
const WEBMCP_INDEX_USER_ID = '1f5d3b90-6c42-4a17-9e08-3d7b5c214e6a';

export const INDEXING_CAPS = {
  /**
   * Images accepted per job. Anything beyond this is reported, not silent.
   * Sized to fit the bundled 100-image demo zip (`data/samples/sample-art-100.zip`)
   * through the anonymous path, so a judge who uploads it gets the whole
   * collection rather than a silently truncated 40.
   */
  maxFilesPerJob: 100,
  /** Per-image byte ceiling. */
  maxFileBytes: 8 * 1024 * 1024,
  /** Whole-job byte ceiling. */
  maxTotalBytes: 120 * 1024 * 1024,
  /** Images the client should send per /items call. */
  batchSize: 4,
  /** Hard server-side ceiling per /items call (subrequest budget). */
  maxBatchSize: 6,
  /**
   * Jobs one edge address may create per hour. Generous on purpose: this is
   * an anonymous demo surface, and someone evaluating it will index several
   * collections in a sitting. The real backstop on abuse is
   * `maxSandboxArtworks` below, which bounds total stored work regardless of
   * how many jobs produced it.
   */
  maxJobsPerClientPerHour: 24,
  /** Backstop on total sandbox size before new jobs are refused. */
  maxSandboxArtworks: 5000,
} as const;

export const INDEXABLE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

const JINA_INDEX_MODEL_DEFAULT = 'jina-clip-v2';
const JINA_INDEX_DIMENSIONS_DEFAULT = 1024;
const JINA_EMBEDDINGS_ENDPOINT = 'https://api.jina.ai/v1/embeddings';

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

export type PlannedFile = { name: string; size: number };

export type IndexPlanEntry = {
  name: string;
  accepted: boolean;
  reason?: string;
};

export type IndexPlan = {
  entries: IndexPlanEntry[];
  accepted: string[];
  notices: string[];
};

export const inferMimeType = (name: string, declared?: string | null) => {
  const normalized = (declared || '').trim().toLowerCase();
  if (INDEXABLE_MIME_TYPES.has(normalized)) {
    return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
  }
  const extension = name.split('.').pop()?.toLowerCase() || '';
  return EXTENSION_MIME[extension] || null;
};

/**
 * Decide what a job will actually contain. Over-cap files are dropped with a
 * stated reason rather than failing the whole request — the status payload
 * surfaces both, so the agent can tell the human the truth.
 */
export const planIndexJob = (
  files: PlannedFile[],
  caps: typeof INDEXING_CAPS = INDEXING_CAPS
): IndexPlan => {
  const entries: IndexPlanEntry[] = [];
  const notices: string[] = [];
  const seen = new Set<string>();
  let acceptedBytes = 0;
  let overCapCount = 0;
  let tooLargeCount = 0;
  let nonImageCount = 0;
  let budgetCount = 0;

  for (const file of files) {
    const name = String(file?.name ?? '').trim();
    if (!name) continue;

    if (seen.has(name)) {
      entries.push({
        name,
        accepted: false,
        reason: 'Duplicate filename within the archive',
      });
      continue;
    }
    seen.add(name);

    const size = Number.isFinite(file.size) ? Number(file.size) : 0;

    if (!inferMimeType(name)) {
      nonImageCount += 1;
      entries.push({
        name,
        accepted: false,
        reason: 'Not a supported image (jpeg, png, webp, gif, avif)',
      });
      continue;
    }
    if (size > caps.maxFileBytes) {
      tooLargeCount += 1;
      entries.push({
        name,
        accepted: false,
        reason: `Larger than the ${Math.round(caps.maxFileBytes / (1024 * 1024))}MB per-image limit`,
      });
      continue;
    }
    if (entries.filter((entry) => entry.accepted).length >= caps.maxFilesPerJob) {
      overCapCount += 1;
      entries.push({
        name,
        accepted: false,
        reason: `Beyond the ${caps.maxFilesPerJob}-image limit for one job`,
      });
      continue;
    }
    if (acceptedBytes + size > caps.maxTotalBytes) {
      budgetCount += 1;
      entries.push({
        name,
        accepted: false,
        reason: `Beyond the ${Math.round(caps.maxTotalBytes / (1024 * 1024))}MB total limit for one job`,
      });
      continue;
    }

    acceptedBytes += size;
    entries.push({ name, accepted: true });
  }

  if (nonImageCount) {
    notices.push(`${nonImageCount} non-image file(s) skipped.`);
  }
  if (tooLargeCount) {
    notices.push(
      `${tooLargeCount} image(s) skipped for exceeding ${Math.round(caps.maxFileBytes / (1024 * 1024))}MB.`
    );
  }
  if (overCapCount) {
    notices.push(
      `Only the first ${caps.maxFilesPerJob} images are indexed; ${overCapCount} were skipped.`
    );
  }
  if (budgetCount) {
    notices.push(
      `${budgetCount} image(s) skipped after the ${Math.round(caps.maxTotalBytes / (1024 * 1024))}MB job budget was reached.`
    );
  }

  return {
    entries,
    accepted: entries.filter((entry) => entry.accepted).map((entry) => entry.name),
    notices,
  };
};

export type ItemMetadata = {
  title?: string | null;
  artist?: string | null;
  year?: number | null;
  date_text?: string | null;
  medium?: string | null;
  classification?: string | null;
  description?: string | null;
  credit_line?: string | null;
  accession_number?: string | null;
};

const trimmedOrNull = (value: unknown, max: number) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
};

/** Filenames are the only metadata most piles of images carry. */
export const titleFromFilename = (name: string) => {
  const base = name.split('/').pop() || name;
  const withoutExtension = base.replace(/\.[^.]+$/, '');
  const spaced = withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return spaced || base;
};

export const sanitizeItemMetadata = (input: unknown): ItemMetadata => {
  const source = (input && typeof input === 'object' ? input : {}) as Record<
    string,
    unknown
  >;
  const rawYear = source.year;
  const year =
    typeof rawYear === 'number' && Number.isInteger(rawYear)
      ? rawYear
      : typeof rawYear === 'string' && /^\d{3,4}$/.test(rawYear.trim())
        ? Number(rawYear.trim())
        : null;

  return {
    title: trimmedOrNull(source.title, 500),
    artist: trimmedOrNull(source.artist, 255),
    year: year !== null && year >= 0 && year <= 9999 ? year : null,
    date_text: trimmedOrNull(source.date_text, 255),
    medium: trimmedOrNull(source.medium, 255),
    classification: trimmedOrNull(source.classification, 255),
    description: trimmedOrNull(source.description, 5000),
    credit_line: trimmedOrNull(source.credit_line, 5000),
    accession_number: trimmedOrNull(source.accession_number, 255),
  };
};

/** The text an image's caption vector is built from. */
export const buildCaptionText = (
  metadata: ItemMetadata,
  filename: string
): string =>
  [
    metadata.title || titleFromFilename(filename),
    metadata.artist,
    metadata.date_text || (metadata.year ? String(metadata.year) : null),
    metadata.medium,
    metadata.classification,
    metadata.description,
  ]
    .filter((part): part is string => Boolean(part && String(part).trim()))
    .join('. ')
    .slice(0, 2000);

// ---------------------------------------------------------------------------
// Suggested searches for a freshly indexed collection
// ---------------------------------------------------------------------------

export type CollectionSuggestion = {
  id: string;
  type: 'artist' | 'classification' | 'medium' | 'era' | 'keyword' | 'subject';
  label: string;
  query: string;
};

export type CollectionSuggestions = {
  /**
   * Where the queries came from: a CSV sidecar's catalogue fields, the image
   * filenames when those carry real words, or broad subject queries when
   * neither does.
   */
  source: 'metadata' | 'filenames' | 'generic';
  generatedAt: string;
  suggestions: CollectionSuggestion[];
};

export type SuggestionSourceRow = {
  title: string | null;
  artist: string | null;
  year: number | null;
  medium: string | null;
  classification: string | null;
};

const MAX_COLLECTION_SUGGESTIONS = 6;

/**
 * Catalogues record an unattributed work in a dozen ways. "Works by Unknown"
 * is a suggestion nobody wants and it matches nothing, so drop them.
 */
const ANONYMOUS_ARTIST =
  /^(unknown|unidentified|anonymous|unattributed|various|n\.?a\.?|none)\b/i;
const isAnonymousArtist = (value: string) => ANONYMOUS_ARTIST.test(value.trim());

/**
 * Medium and classification strings run from "oil on canvas" to a full
 * conservation note. Anything long makes an unreadable chip and a hopeless
 * query, so only offer the concise ones.
 */
const isConciseFacet = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 40 && !trimmed.includes(';');
};

/** Years outside this range are a parse artifact, not a date. */
const isPlausibleYear = (year: unknown): year is number =>
  typeof year === 'number' &&
  Number.isInteger(year) &&
  year >= 1000 &&
  year <= new Date().getUTCFullYear() + 1;

const slugifySuggestion = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
    .slice(0, 60) || 'x';

/** Dedupe case-insensitively, keep the most common casing, most frequent first. */
const topByFrequency = (values: string[], limit: number): string[] => {
  const counts = new Map<string, { display: string; count: number }>();
  for (const value of values) {
    const key = value.toLowerCase();
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { display: value, count: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.display.localeCompare(b.display))
    .slice(0, limit)
    .map((entry) => entry.display);
};

const GENERIC_TITLE =
  /^(img|dsc|scan|photo|photograph|image|untitled|copy|final)[\s_-]*\d*$/i;

/**
 * Last-resort queries for a collection whose filenames are opaque. These lean
 * on the image vectors rather than the caption text, so they work even when a
 * collection carries no usable words at all — measured against the bundled
 * 25-image NGA archive (accession-number filenames, no CSV), where every one
 * of these returns real ranked hits.
 */
const SUBJECT_SUGGESTIONS: ReadonlyArray<{ label: string; query: string }> = [
  { label: 'A painting', query: 'a painting' },
  { label: 'A portrait', query: 'a portrait' },
  { label: 'A landscape', query: 'a landscape' },
  { label: 'A photograph', query: 'a photograph' },
  { label: 'A drawing or print', query: 'a drawing or print' },
  { label: 'A building', query: 'a building' },
];

/**
 * A filename only makes a usable query if it carries actual words. An
 * accession number like `nga-140010.jpg` becomes the title "nga 140010",
 * which clears a naive length check but embeds to noise — and that is exactly
 * the shape of the archive the demo picker ships.
 */
const isWordyTitle = (title: string) =>
  title.split(/\s+/).filter((word) => /^[a-z]{3,}$/i.test(word)).length >= 2;

/**
 * Grounds suggested queries in whatever real signal a collection has. A CSV
 * sidecar means artist/medium/classification/year are populated, so those
 * facets drive the suggestions. Without one, only filename-derived titles
 * exist (see `titleFromFilename`) — those double as the caption text this
 * collection's own image vectors were embedded against, so they still make
 * usable, honest queries; the caller is told which case it got via `source`.
 */
export const deriveCollectionSuggestions = (
  rows: readonly SuggestionSourceRow[],
  now: () => Date = () => new Date()
): CollectionSuggestions => {
  const hasMetadata = rows.some(
    (row) => row.artist || row.medium || row.classification
  );
  let source: CollectionSuggestions['source'] = hasMetadata
    ? 'metadata'
    : 'filenames';
  const suggestions: CollectionSuggestion[] = [];

  if (hasMetadata) {
    const artistSuggestions = topByFrequency(
      rows
        .map((row) => row.artist)
        .filter(
          (v): v is string => typeof v === 'string' && !isAnonymousArtist(v)
        ),
      2
    ).map((artist) => ({
      id: `artist:${slugifySuggestion(artist)}`,
      type: 'artist' as const,
      label: `Works by ${artist}`,
      query: artist,
    }));

    const classificationSuggestions = topByFrequency(
      rows
        .map((row) => row.classification)
        .filter(
          (v): v is string => typeof v === 'string' && isConciseFacet(v)
        ),
      2
    ).map((classification) => ({
      id: `classification:${slugifySuggestion(classification)}`,
      type: 'classification' as const,
      label: `${classification} works`,
      query: classification,
    }));

    const seenLabels = new Set(
      classificationSuggestions.map((entry) => entry.label)
    );
    const mediumSuggestions = topByFrequency(
      rows
        .map((row) => row.medium)
        .filter(
          (v): v is string => typeof v === 'string' && isConciseFacet(v)
        ),
      2
    )
      .map((medium) => ({
        id: `medium:${slugifySuggestion(medium)}`,
        type: 'medium' as const,
        label: `${medium} pieces`,
        query: medium,
      }))
      .filter((entry) => !seenLabels.has(entry.label));

    // A single mis-parsed cell (an accession number read as a year, say)
    // otherwise produces an era like "Art from 12-1459". Require a plausible
    // year, and take the 10th/90th percentile rather than the extremes so one
    // outlier cannot define the range.
    const years = rows
      .map((row) => row.year)
      .filter(isPlausibleYear)
      .sort((a, b) => a - b);
    const minYear =
      years.length >= 3 ? years[Math.floor(years.length * 0.1)]! : null;
    const maxYear =
      years.length >= 3 ? years[Math.ceil(years.length * 0.9) - 1]! : null;
    const eraSuggestions =
      minYear !== null && maxYear !== null && minYear !== maxYear
        ? [
            {
              id: `era:${minYear}-${maxYear}`,
              type: 'era' as const,
              label: `Art from ${minYear}–${maxYear}`,
              query: `${minYear} to ${maxYear}`,
            },
          ]
        : [];

    // Round-robin across categories so one of each survives the cap below,
    // rather than two artists crowding out the era or medium entirely.
    const rounds = [
      [eraSuggestions[0], artistSuggestions[0], classificationSuggestions[0], mediumSuggestions[0]],
      [artistSuggestions[1], classificationSuggestions[1], mediumSuggestions[1]],
    ];
    for (const round of rounds) {
      for (const suggestion of round) {
        if (suggestion) suggestions.push(suggestion);
      }
    }
  } else {
    const titles = rows
      .map((row) => row.title?.trim())
      .filter(
        (title): title is string =>
          typeof title === 'string' &&
          title.length >= 4 &&
          !GENERIC_TITLE.test(title) &&
          isWordyTitle(title)
      );

    for (const title of topByFrequency(titles, titles.length).slice(0, 4)) {
      suggestions.push({
        id: `keyword:${slugifySuggestion(title)}`,
        type: 'keyword',
        label: title.replace(/\b\w/g, (char) => char.toUpperCase()),
        query: title,
      });
    }

    // Opaque filenames leave nothing worth suggesting. Offering "Nga 140010"
    // as a query would be worse than offering nothing: it looks like a real
    // suggestion and returns noise. An empty collection is different — there
    // is genuinely nothing to search, so it still gets no suggestions.
    if (suggestions.length === 0 && rows.length > 0) {
      source = 'generic';
      for (const subject of SUBJECT_SUGGESTIONS) {
        suggestions.push({
          id: `subject:${slugifySuggestion(subject.query)}`,
          type: 'subject',
          label: subject.label,
          query: subject.query,
        });
      }
    }
  }

  return {
    source,
    generatedAt: now().toISOString(),
    suggestions: suggestions.slice(0, MAX_COLLECTION_SUGGESTIONS),
  };
};

/** Bumped to v2 when motif suggestions landed, to drop the facet-only bundles. */
const SUGGESTIONS_CACHE_VERSION = 'v4';
const SUGGESTIONS_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Computed once per collection and cached in KV, not recomputed per status
 * poll or page view. KV is best-effort, matching `withinJobRateLimit` below —
 * a cache miss just recomputes from D1 rather than failing the request.
 */
/**
 * Motif suggestions: what you would actually see in these works.
 *
 * `deriveCollectionSuggestions` is deterministic and grounded, but its output
 * is a facet dump — "Painting works", "oil on canvas pieces". True, and dull:
 * it tells a visitor what the columns contain, not what the pictures are of,
 * and nobody's first search is "Print works".
 *
 * So one small LLM call reads a sample of this collection's real titles and
 * proposes subject phrases. It is grounded in titles that exist, and — unlike a
 * facet query — a motif produces no structured filter, so it cannot cull its
 * own results to nothing the way "Works by Eadweard Muybridge" once did. Vector
 * search always returns its nearest neighbours.
 *
 * Fail-open in every direction: no key, no budget, bad JSON, slow response —
 * the caller keeps the deterministic bundle exactly as it was.
 */
const MOTIF_TIMEOUT_MS = 12000;
const MAX_MOTIFS = 4;

const proposeMotifSuggestions = async (
  env: Env,
  rows: readonly SuggestionSourceRow[]
): Promise<CollectionSuggestion[]> => {
  const titles = rows
    .map((row) => row.title?.trim())
    .filter((title): title is string => typeof title === 'string' && title.length >= 4)
    .slice(0, 60);
  if (titles.length < 8) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MOTIF_TIMEOUT_MS);
  try {
    const completion = await openaiCompletion({
      env,
      json: true,
      maxTokens: 220,
      signal: controller.signal,
      messages: [
        {
          role: 'system',
          content:
            'You write search suggestions for an art collection. Given real work titles, propose short phrases describing SUBJECTS OR MOODS a visitor could search for — what is depicted, not the catalogue fields. Never propose an artist name, a medium, a date, or a classification. Two to five words each, lowercase, no punctuation. Only subjects clearly present in the titles given. Reply as JSON: {"motifs":["...","..."]}',
        },
        {
          role: 'user',
          content: `Titles from this collection:\n${titles.join('\n')}`,
        },
      ],
    });

    // The model is asked for {"motifs": [...]}, but a bare array or a differently
    // named key is a normal thing for it to return and not worth losing the
    // whole suggestion set over.
    const payload = completion as unknown;
    const motifs: unknown[] = Array.isArray(payload)
      ? payload
      : (() => {
          const record = (payload ?? {}) as Record<string, unknown>;
          for (const key of ['motifs', 'suggestions', 'queries', 'subjects']) {
            if (Array.isArray(record[key])) return record[key] as unknown[];
          }
          // Any single array value will do — the shape matters, not the name.
          const firstArray = Object.values(record).find((value) =>
            Array.isArray(value)
          );
          return Array.isArray(firstArray) ? (firstArray as unknown[]) : [];
        })();

    const seen = new Set<string>();
    const out: CollectionSuggestion[] = [];
    for (const raw of motifs) {
      const query = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
      if (!query || query.length < 3 || query.length > 60) continue;
      if (query.split(/\s+/).length > 6) continue;
      if (seen.has(query)) continue;
      seen.add(query);
      out.push({
        id: `subject:${slugifySuggestion(query)}`,
        type: 'subject',
        label: query.replace(/^\w/, (c) => c.toUpperCase()),
        query,
      });
      if (out.length >= MAX_MOTIFS) break;
    }
    return out;
  } catch {
    // Any failure at all: the deterministic suggestions still stand.
    return [];
  } finally {
    clearTimeout(timer);
  }
};

const getCollectionSuggestions = async (
  env: Env,
  collectionId: string
): Promise<CollectionSuggestions> => {
  const cacheKey = `webmcp-index-suggestions:${SUGGESTIONS_CACHE_VERSION}:${collectionId}`;

  if (env.CACHE) {
    try {
      const cached = await env.CACHE.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as CollectionSuggestions;
        if (parsed && Array.isArray(parsed.suggestions)) return parsed;
      }
    } catch {
      // Fall through and recompute.
    }
  }

  const { results } = await env.DB.prepare(
    `SELECT title, artist, year, medium, classification
     FROM artworks
     WHERE collection_id = ? AND org_id = ? AND deleted_at IS NULL
     LIMIT 1000`
  )
    .bind(collectionId, WEBMCP_INDEX_ORG_ID)
    .all<SuggestionSourceRow>();

  const bundle = deriveCollectionSuggestions(results);

  // Motifs lead, facets follow. A visitor wants somewhere to start; a curator
  // still gets the artist and medium entries underneath.
  const motifs = await proposeMotifSuggestions(env, results);
  if (motifs.length > 0) {
    const taken = new Set(motifs.map((motif) => motif.id));
    bundle.suggestions = [
      ...motifs,
      ...bundle.suggestions.filter((entry) => !taken.has(entry.id)),
    ].slice(0, MAX_COLLECTION_SUGGESTIONS);
  }

  if (env.CACHE) {
    try {
      await env.CACHE.put(cacheKey, JSON.stringify(bundle), {
        expirationTtl: SUGGESTIONS_CACHE_TTL_SECONDS,
      });
    } catch {
      // Best-effort cache; the next read just recomputes.
    }
  }

  return bundle;
};

export type JobStatusRow = {
  id: string;
  org_id: string;
  collection_id: string;
  collection_name: string;
  state: 'queued' | 'running' | 'complete' | 'failed';
  total: number;
  processed: number;
  failed: number;
  notice: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type JobStatusPayload = {
  jobId: string;
  state: JobStatusRow['state'];
  processed: number;
  total: number;
  collectionId: string;
  errors: Array<{ file: string; message: string }>;
  // Additive fields — the agent gets an honest account, not just a number.
  collectionName: string;
  orgId: string;
  failed: number;
  searchable: boolean;
  notice: string | null;
  caps: typeof INDEXING_CAPS;
};

export const buildJobStatus = (
  row: JobStatusRow,
  errors: Array<{ file: string; message: string }>
): JobStatusPayload => ({
  jobId: row.id,
  state: row.state,
  processed: row.processed,
  total: row.total,
  collectionId: row.collection_id,
  errors,
  collectionName: row.collection_name,
  orgId: row.org_id,
  failed: row.failed,
  // Vectors land per image, so partial results are already searchable.
  searchable: row.processed > 0,
  notice: row.error_message
    ? [row.notice, row.error_message].filter(Boolean).join(' ')
    : row.notice,
  caps: INDEXING_CAPS,
});

// ---------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------

const jsonError = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

const toHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );

const sha256Hex = async (value: string | ArrayBuffer) =>
  toHex(
    await crypto.subtle.digest(
      'SHA-256',
      typeof value === 'string' ? new TextEncoder().encode(value) : value
    )
  );

/**
 * Only Cloudflare's injected connecting address can separate anonymous
 * visitors. A client-supplied header must never be substituted here.
 * Exported for the metadata-map route, which shares the limiter below.
 */
export const getClientHash = async (connectingIp: string | undefined) => {
  const candidate = connectingIp?.trim();
  if (!candidate || candidate.length > 45) return null;
  return sha256Hex(`webmcp-index:${candidate}`);
};

const getJinaIndexConfig = (env: Env) => ({
  apiKey: env.JINA_API_KEY || env.QUERY_EMBEDDING_API_TOKEN,
  model: env.JINA_MULTIMODAL_MODEL || JINA_INDEX_MODEL_DEFAULT,
  dimensions: Number(env.JINA_EMBEDDING_DIMENSIONS) || JINA_INDEX_DIMENSIONS_DEFAULT,
});

const getIndexVectorize = (env: Env): Vectorize | undefined =>
  env.EMBEDDING_INDEX_VERSION?.trim().toLowerCase() === 'v2'
    ? env.VECTORIZE_V2 || env.VECTORIZE
    : env.VECTORIZE;

const l2Normalize = (values: number[]) => {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return !Number.isFinite(norm) || norm === 0
    ? values
    : values.map((value) => value / norm);
};

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

/**
 * Index-time vectors must live in the same space the NGA corpus was built in:
 * jina-clip-v2 / retrieval.query / 1024 dims, L2-normalised.
 *
 * `retrieval.query` (not `retrieval.passage`, which reads like the natural
 * choice for ingestion) is deliberate: the deployed embedding endpoint only
 * accepts `retrieval.query` for this model, and the whole existing corpus is
 * embedded that way — see `search.ts` and the `retrieval.query` suffix baked
 * into the search index version. Sending `retrieval.passage` here made every
 * image fail validation and silently produced empty collections.
 */
const generateIndexEmbedding = async (
  apiKey: string,
  input: string | { image: string },
  model: string,
  dimensions: number,
  signal?: AbortSignal
): Promise<number[]> => {
  const response = await fetch(JINA_EMBEDDINGS_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [input],
      normalized: true,
      embedding_type: 'float',
      task: 'retrieval.query',
      dimensions,
      truncate: true,
    }),
    signal,
  });

  const payload = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
    detail?: string;
    code?: string;
  };
  if (!response.ok) {
    throw new Error(
      payload.detail || payload.code || `Jina request failed with ${response.status}`
    );
  }

  const embedding = payload.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== dimensions) {
    throw new Error('Jina embedding was empty or had the wrong dimensions');
  }
  return l2Normalize(embedding);
};

const readJob = (db: D1Database, jobId: string) =>
  db
    .prepare('SELECT * FROM index_jobs WHERE id = ? AND org_id = ?')
    .bind(jobId, WEBMCP_INDEX_ORG_ID)
    .first<JobStatusRow>();

const readJobErrors = async (db: D1Database, jobId: string) => {
  const { results } = await db
    .prepare(
      `SELECT filename, message FROM index_job_items
       WHERE job_id = ? AND state IN ('failed', 'skipped')
       ORDER BY created_at LIMIT 100`
    )
    .bind(jobId)
    .all<{ filename: string; message: string | null }>();

  return results.map((row) => ({
    file: row.filename,
    message: row.message || 'Indexing failed',
  }));
};

const respondWithStatus = async (env: Env, row: JobStatusRow) => ({
  ...buildJobStatus(row, await readJobErrors(env.DB, row.id)),
  // Only a completed job has a fixed image set worth summarising; suggesting
  // queries mid-upload would mean recomputing (and invalidating) them as more
  // images land.
  suggestions:
    row.state === 'complete'
      ? await getCollectionSuggestions(env, row.collection_id)
      : null,
});

/**
 * Anonymous writes need a ceiling. KV is best-effort: when the binding is
 * absent (unit tests, local dev) or errors, indexing stays available and the
 * per-job caps remain the binding constraint.
 *
 * Shared with the other anonymous LLM surface (`metadata-map`), which passes
 * its own key prefix and a much lower hourly limit.
 */
export const withinJobRateLimit = async (
  env: Env,
  clientHash: string | null,
  options: { keyPrefix?: string; limitPerHour?: number } = {}
): Promise<boolean> => {
  const keyPrefix = options.keyPrefix ?? 'webmcp-index-jobs:v1';
  const limitPerHour =
    options.limitPerHour ?? INDEXING_CAPS.maxJobsPerClientPerHour;
  if (!clientHash || !env.CACHE) return true;
  const bucket = Math.floor(Date.now() / 3_600_000);
  const key = `${keyPrefix}:${bucket}:${clientHash}`;
  try {
    const used = Number((await env.CACHE.get(key)) || '0');
    if (Number.isFinite(used) && used >= limitPerHour) {
      return false;
    }
    await env.CACHE.put(key, String((Number.isFinite(used) ? used : 0) + 1), {
      expirationTtl: 7200,
    });
    return true;
  } catch {
    return true;
  }
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const indexing = new Hono<{ Bindings: Env }>();

indexing.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

/**
 * POST /public-index/jobs
 * Create a job and its collection. Returns immediately so a WebMCP tool can.
 */
indexing.post('/jobs', async (c) => {
  let body: {
    collectionName?: unknown;
    orgId?: unknown;
    source?: unknown;
    files?: unknown;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json(jsonError('INVALID_INPUT', 'Invalid JSON request body.'), 400);
  }

  const collectionName =
    trimmedOrNull(body.collectionName, 200) ||
    `Agent collection ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
  const source = body.source === 'files' ? 'files' : 'zip';
  const files = Array.isArray(body.files) ? (body.files as PlannedFile[]) : [];

  if (files.length === 0) {
    return c.json(
      jsonError('INVALID_INPUT', 'At least one file is required to create a job.'),
      400
    );
  }
  if (files.length > 5000) {
    return c.json(
      jsonError('INVALID_INPUT', 'Too many file entries in one request.'),
      400
    );
  }

  const clientHash = await getClientHash(c.req.header('CF-Connecting-IP'));
  if (!(await withinJobRateLimit(c.env, clientHash))) {
    c.header('Retry-After', '600');
    return c.json(
      jsonError(
        'INDEXING_RATE_LIMITED',
        `Only ${INDEXING_CAPS.maxJobsPerClientPerHour} indexing jobs may be created per hour. Try again later.`
      ),
      429
    );
  }

  const sandboxSize = await c.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM artworks WHERE org_id = ? AND deleted_at IS NULL'
  )
    .bind(WEBMCP_INDEX_ORG_ID)
    .first<{ count: number }>();
  if ((sandboxSize?.count ?? 0) >= INDEXING_CAPS.maxSandboxArtworks) {
    return c.json(
      jsonError(
        'INDEXING_SANDBOX_FULL',
        'The shared indexing sandbox is full. Ask an operator to clear it.'
      ),
      503
    );
  }

  const plan = planIndexJob(files);
  if (plan.accepted.length === 0) {
    return c.json(
      jsonError(
        'NO_INDEXABLE_FILES',
        plan.notices.join(' ') || 'No supported images were found.'
      ),
      400
    );
  }

  const requestedOrgId = trimmedOrNull(body.orgId, 200);
  const notices = [...plan.notices];
  if (
    requestedOrgId &&
    requestedOrgId.toLowerCase() !== WEBMCP_INDEX_ORG_ID &&
    requestedOrgId.toLowerCase() !== WEBMCP_INDEX_ORG_SLUG
  ) {
    // Never silently write somewhere the caller did not expect.
    notices.unshift(
      `Anonymous indexing writes to the shared "${WEBMCP_INDEX_ORG_SLUG}" sandbox, not "${requestedOrgId}".`
    );
  }

  const jobId = crypto.randomUUID();
  const collectionId = crypto.randomUUID();

  await c.env.DB.prepare(
    `INSERT INTO collections (id, org_id, name, description, created_by)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      collectionId,
      WEBMCP_INDEX_ORG_ID,
      collectionName,
      `Indexed by a browser agent through WebMCP (${source}).`,
      WEBMCP_INDEX_USER_ID
    )
    .run();

  await c.env.DB.prepare(
    `INSERT INTO index_jobs (
       id, org_id, collection_id, collection_name, source, state, total, client_hash, notice
     ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)`
  )
    .bind(
      jobId,
      WEBMCP_INDEX_ORG_ID,
      collectionId,
      collectionName,
      source,
      plan.accepted.length,
      clientHash,
      notices.join(' ') || null
    )
    .run();

  // Record the rejects up front so the very first status poll is already honest.
  const rejected = plan.entries.filter((entry) => !entry.accepted).slice(0, 100);
  if (rejected.length) {
    await c.env.DB.batch(
      rejected.map((entry) =>
        c.env.DB.prepare(
          `INSERT OR IGNORE INTO index_job_items (id, job_id, filename, state, message)
           VALUES (?, ?, ?, 'skipped', ?)`
        ).bind(crypto.randomUUID(), jobId, entry.name, entry.reason || 'Skipped')
      )
    );
  }

  return c.json(
    {
      success: true,
      data: {
        jobId,
        collectionId,
        orgId: WEBMCP_INDEX_ORG_ID,
        collectionName,
        accepted: plan.accepted,
        skipped: rejected.map((entry) => ({
          file: entry.name,
          message: entry.reason || 'Skipped',
        })),
        notice: notices.join(' ') || null,
        batchSize: INDEXING_CAPS.batchSize,
        caps: INDEXING_CAPS,
      },
    },
    201
  );
});

/**
 * POST /public-index/jobs/:jobId/items
 * Ingest one small batch: R2 -> D1 -> image vector -> caption vector.
 * Partial failure is per-file and never fails the batch.
 */
indexing.post('/jobs/:jobId/items', async (c) => {
  const jobId = c.req.param('jobId');
  const job = await readJob(c.env.DB, jobId);
  if (!job) {
    return c.json(jsonError('NOT_FOUND', 'Indexing job not found.'), 404);
  }
  if (job.state === 'complete' || job.state === 'failed') {
    return c.json(
      jsonError('JOB_CLOSED', `Indexing job is already ${job.state}.`),
      409
    );
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json(jsonError('INVALID_INPUT', 'Expected multipart form data.'), 400);
  }

  // workers-types declares FormData values as strings; at runtime uploaded
  // parts are File objects, so identify them structurally.
  const files = (formData.getAll('files') as unknown[]).filter(
    (value): value is File =>
      typeof value === 'object' &&
      value !== null &&
      typeof (value as File).arrayBuffer === 'function'
  );
  if (files.length === 0) {
    return c.json(jsonError('INVALID_INPUT', 'No files in this batch.'), 400);
  }
  if (files.length > INDEXING_CAPS.maxBatchSize) {
    return c.json(
      jsonError(
        'BATCH_TOO_LARGE',
        `At most ${INDEXING_CAPS.maxBatchSize} images may be sent per batch.`
      ),
      400
    );
  }

  let metadataByFile: Record<string, unknown> = {};
  const rawMetadata = formData.get('metadata');
  if (typeof rawMetadata === 'string' && rawMetadata.trim()) {
    try {
      const parsed = JSON.parse(rawMetadata);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadataByFile = parsed as Record<string, unknown>;
      }
    } catch {
      // Bad sidecar metadata degrades to filename-derived titles; it is never
      // a reason to drop the images the human actually asked to index.
    }
  }

  if (job.state === 'queued') {
    await c.env.DB.prepare("UPDATE index_jobs SET state = 'running' WHERE id = ?")
      .bind(jobId)
      .run();
  }

  const jina = getJinaIndexConfig(c.env);
  const vectorize = getIndexVectorize(c.env);
  const captionVectorize =
    c.env.EMBEDDING_INDEX_VERSION?.trim().toLowerCase() === 'v2'
      ? c.env.CAPTION_VECTORIZE_V2 || c.env.CAPTION_VECTORIZE
      : c.env.CAPTION_VECTORIZE;

  const results: Array<{
    file: string;
    ok: boolean;
    artworkId?: string;
    message?: string;
  }> = [];

  // The client resends a batch when a response is lost, not only when the
  // server rejected the work — so the same file can arrive twice after it was
  // already indexed. Without this, the retry mints a second artwork row, a
  // second R2 object and a second Vectorize entry for one image (the same
  // picture then comes back twice in search) and increments `processed` again,
  // which can push it past `total` and render "6 of 5 images indexed".
  const alreadyComplete = new Map<string, string | null>();
  const { results: completedRows } = await c.env.DB.prepare(
    `SELECT filename, artwork_id FROM index_job_items
     WHERE job_id = ? AND state = 'complete'`
  )
    .bind(jobId)
    .all<{ filename: string; artwork_id: string | null }>();
  for (const row of completedRows ?? []) {
    alreadyComplete.set(row.filename, row.artwork_id);
  }

  for (const file of files) {
    const filename = file.name || 'untitled';
    if (alreadyComplete.has(filename)) {
      results.push({
        file: filename,
        ok: true,
        artworkId: alreadyComplete.get(filename) ?? undefined,
      });
      continue;
    }
    try {
      const mimeType = inferMimeType(filename, file.type);
      if (!mimeType) {
        throw new Error('Unsupported image type');
      }
      if (file.size > INDEXING_CAPS.maxFileBytes) {
        throw new Error('Image exceeds the per-image size limit');
      }
      if (!jina.apiKey) {
        throw new Error('Embedding provider is not configured');
      }
      if (!vectorize) {
        throw new Error('Vector index is not configured');
      }

      const buffer = await file.arrayBuffer();
      if (buffer.byteLength === 0) {
        throw new Error('File is empty');
      }

      const metadata = sanitizeItemMetadata(metadataByFile[filename]);
      const artworkId = crypto.randomUUID();
      const assetId = crypto.randomUUID();
      const imageHash = await sha256Hex(buffer);

      const upload = await uploadImage(c.env.IMAGES, buffer, {
        originalFilename: filename,
        uploadedBy: WEBMCP_INDEX_USER_ID,
        galleryId: WEBMCP_INDEX_ORG_ID,
        hash: imageHash,
      });

      const imageUrl = `${new URL(c.req.url).origin}/api/v1/public-index/assets/${assetId}`;
      const title = metadata.title || titleFromFilename(filename);

      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO artworks (
             id, org_id, collection_id, image_url, thumbnail_url,
             original_filename, image_hash, embedding_id,
             title, artist, year, date_text, medium, classification,
             description, credit_line, accession_number,
             field_sources, translations, custom_metadata, uploaded_by
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', '{}', ?, ?)`
        ).bind(
          artworkId,
          WEBMCP_INDEX_ORG_ID,
          job.collection_id,
          imageUrl,
          imageUrl,
          filename,
          imageHash,
          artworkId,
          title,
          metadata.artist,
          metadata.year,
          metadata.date_text,
          metadata.medium,
          metadata.classification,
          metadata.description,
          metadata.credit_line,
          metadata.accession_number,
          JSON.stringify({
            provider: 'webmcp-index',
            indexJobId: jobId,
            assetId,
          }),
          WEBMCP_INDEX_USER_ID
        ),
        c.env.DB.prepare(
          `INSERT INTO assets (
             id, artwork_id, org_id, role, storage_provider, object_key, url,
             mime_type, size_bytes, metadata
           ) VALUES (?, ?, ?, 'original', 'r2', ?, ?, ?, ?, ?)`
        ).bind(
          assetId,
          artworkId,
          WEBMCP_INDEX_ORG_ID,
          upload.key,
          imageUrl,
          mimeType,
          upload.size,
          JSON.stringify({ originalFilename: filename, indexJobId: jobId })
        ),
        c.env.DB.prepare(
          `INSERT OR IGNORE INTO collection_artworks (collection_id, artwork_id, position)
           VALUES (?, ?, 0)`
        ).bind(job.collection_id, artworkId),
      ]);

      const vectorMetadata = {
        orgId: WEBMCP_INDEX_ORG_ID,
        galleryId: WEBMCP_INDEX_ORG_ID,
        artworkId,
        collectionId: job.collection_id,
        indexJobId: jobId,
        provider: 'webmcp-index',
        embeddingVersion: 'v2',
        title,
        artist: metadata.artist || '',
        medium: metadata.medium || '',
        classification: metadata.classification || '',
        year: metadata.year || 0,
        yearStart: metadata.year || 0,
        yearEnd: metadata.year || 0,
      };

      const imageEmbedding = await generateIndexEmbedding(
        jina.apiKey,
        { image: arrayBufferToBase64(buffer) },
        jina.model,
        jina.dimensions
      );
      await vectorize.upsert([
        { id: artworkId, values: imageEmbedding, metadata: { ...vectorMetadata, channel: 'image' } },
      ]);

      // The caption channel is a bonus lane: text search already works from
      // the image vector alone, so a caption failure must not fail the file.
      if (captionVectorize) {
        try {
          const captionEmbedding = await generateIndexEmbedding(
            jina.apiKey,
            buildCaptionText(metadata, filename),
            c.env.JINA_TEXT_MODEL || 'jina-embeddings-v5-text-small',
            Number(c.env.JINA_TEXT_EMBEDDING_DIMENSIONS) || 1024
          );
          await captionVectorize.upsert([
            {
              id: artworkId,
              values: captionEmbedding,
              metadata: { ...vectorMetadata, channel: 'caption' },
            },
          ]);
        } catch (error) {
          console.warn('Caption embedding failed for indexed image', error);
        }
      }

      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO index_job_items (id, job_id, filename, artwork_id, state, size_bytes)
           VALUES (?, ?, ?, ?, 'complete', ?)
           ON CONFLICT(job_id, filename) DO UPDATE SET
             artwork_id = excluded.artwork_id, state = 'complete', message = NULL`
        ).bind(crypto.randomUUID(), jobId, filename, artworkId, upload.size),
        c.env.DB.prepare(
          'UPDATE index_jobs SET processed = processed + 1 WHERE id = ?'
        ).bind(jobId),
      ]);

      results.push({ file: filename, ok: true, artworkId });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to index this file';
      console.warn(`Indexing failed for ${filename}:`, error);
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO index_job_items (id, job_id, filename, state, message)
           VALUES (?, ?, ?, 'failed', ?)
           ON CONFLICT(job_id, filename) DO UPDATE SET
             state = 'failed', message = excluded.message`
        ).bind(crypto.randomUUID(), jobId, filename, message.slice(0, 500)),
        c.env.DB.prepare(
          'UPDATE index_jobs SET failed = failed + 1 WHERE id = ?'
        ).bind(jobId),
      ]);
      results.push({ file: filename, ok: false, message });
    }
  }

  const refreshed = await readJob(c.env.DB, jobId);
  return c.json({
    success: true,
    data: {
      ...(refreshed ? await respondWithStatus(c.env, refreshed) : {}),
      batch: results,
    },
  });
});

/** POST /public-index/jobs/:jobId/complete — close the job out. */
indexing.post('/jobs/:jobId/complete', async (c) => {
  const jobId = c.req.param('jobId');
  const job = await readJob(c.env.DB, jobId);
  if (!job) {
    return c.json(jsonError('NOT_FOUND', 'Indexing job not found.'), 404);
  }

  let reason: string | null = null;
  try {
    const body = (await c.req.json()) as { error?: unknown };
    reason = trimmedOrNull(body?.error, 500);
  } catch {
    reason = null;
  }

  // A job that indexed nothing at all is a failure; anything else is a
  // completion whose per-file errors the status payload already carries.
  const state = reason && job.processed === 0 ? 'failed' : 'complete';
  await c.env.DB.prepare(
    `UPDATE index_jobs
     SET state = ?, error_message = ?, completed_at = datetime('now')
     WHERE id = ?`
  )
    .bind(state, reason, jobId)
    .run();

  const refreshed = await readJob(c.env.DB, jobId);
  return c.json({
    success: true,
    data: refreshed ? await respondWithStatus(c.env, refreshed) : null,
  });
});

/** GET /public-index/jobs/:jobId — the pollable status a WebMCP tool reads. */
indexing.get('/jobs/:jobId', async (c) => {
  const job = await readJob(c.env.DB, c.req.param('jobId'));
  if (!job) {
    return c.json(jsonError('NOT_FOUND', 'Indexing job not found.'), 404);
  }
  return c.json({ success: true, data: await respondWithStatus(c.env, job) });
});

/**
 * POST /public-index/jobs/:jobId/search
 * Semantic search scoped to the collection this job just built. This is the
 * proof that a zip became searchable: same Vectorize index, same embedding
 * space as the rest of Paillette, filtered to the new collection.
 */
/**
 * Rows in this collection that satisfy a hard filter, straight from D1.
 *
 * The vector query returns a semantic top-K and the intent filters then cull
 * it, which fails exactly where the filter is most precise: an artist whose
 * pictures do not look like their name. Searching "Eadweard Muybridge" over
 * jina-clip image vectors surfaces neither of his motion studies in the top 24,
 * so the artist filter had nothing left to keep and a suggestion built from
 * this collection's own catalogue returned zero results.
 *
 * A suggested search must never be empty, so when the filtered vector page is
 * short this fills it from the metadata the filter actually describes.
 */
const queryIndexedByFilters = async (
  db: D1Database,
  collectionId: string,
  filters: QueryIntentFilters,
  limit: number
) => {
  const wheres: string[] = [
    'org_id = ?',
    'collection_id = ?',
    'deleted_at IS NULL',
  ];
  const binds: unknown[] = [WEBMCP_INDEX_ORG_ID, collectionId];

  // LIKE, not equality: the intent is grounded in the collection's own facet
  // values, but a row may carry a longer form of the same value.
  for (const [column, value] of [
    ['artist', filters.artist],
    ['medium', filters.medium],
    ['classification', filters.classification],
  ] as const) {
    if (!value) continue;
    wheres.push(`LOWER(${column}) LIKE ?`);
    binds.push(`%${value.toLowerCase()}%`);
  }
  if (filters.yearFrom !== undefined) {
    wheres.push('year IS NOT NULL AND year >= ?');
    binds.push(filters.yearFrom);
  }
  if (filters.yearTo !== undefined) {
    wheres.push('year IS NOT NULL AND year <= ?');
    binds.push(filters.yearTo);
  }

  try {
    const { results: rows } = await db
      .prepare(
        `SELECT id, title, artist, year, date_text, medium, classification,
                description, original_filename, image_url, custom_metadata
         FROM artworks
         WHERE ${wheres.join(' AND ')}
         ORDER BY year IS NULL, year, title
         LIMIT ?`
      )
      .bind(...binds, limit)
      .all<{
        id: string;
        title: string;
        artist: string | null;
        year: number | null;
        date_text: string | null;
        medium: string | null;
        classification: string | null;
        description: string | null;
        original_filename: string | null;
        image_url: string | null;
        custom_metadata: string | null;
      }>();

    return rows.map((row) => {
      let assetId: string | null = null;
      try {
        assetId = JSON.parse(row.custom_metadata || '{}')?.assetId ?? null;
      } catch {
        assetId = null;
      }
      return {
        id: row.id,
        // Not a vector hit: this row matched the filter, it was not scored.
        similarity: 0,
        title: row.title,
        artist: row.artist,
        year: row.year,
        date_text: row.date_text,
        medium: row.medium,
        classification: row.classification,
        description: row.description,
        original_filename: row.original_filename,
        imageUrl: assetId ? `/api/public-index/assets/${assetId}` : row.image_url,
      };
    });
  } catch (error) {
    // Never fail a search because the supplement failed.
    console.warn('Indexed metadata filter query failed:', error);
    return [];
  }
};

/**
 * Turn Vectorize matches into the artwork records both indexed-collection
 * search routes return. Vector rank order is preserved; a match whose row has
 * since been deleted simply drops out.
 */
const hydrateIndexedMatches = async (
  db: D1Database,
  matches: Array<{ id: string; score: number }>
) => {
  if (matches.length === 0) return [];

  const placeholders = matches.map(() => '?').join(',');
  const { results: rows } = await db
    .prepare(
      `SELECT id, title, artist, year, date_text, medium, classification,
              description, original_filename, image_url, custom_metadata
       FROM artworks
       WHERE org_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`
    )
    .bind(WEBMCP_INDEX_ORG_ID, ...matches.map((match) => match.id))
    .all<{
      id: string;
      title: string;
      artist: string | null;
      year: number | null;
      date_text: string | null;
      medium: string | null;
      classification: string | null;
      description: string | null;
      original_filename: string | null;
      image_url: string | null;
      custom_metadata: string | null;
    }>();

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  return matches
    .map((match) => {
      const row = rowsById.get(match.id);
      if (!row) return null;
      let assetId: string | null = null;
      try {
        assetId = JSON.parse(row.custom_metadata || '{}')?.assetId ?? null;
      } catch {
        assetId = null;
      }
      return {
        id: row.id,
        similarity: match.score,
        title: row.title,
        artist: row.artist,
        year: row.year,
        date_text: row.date_text,
        medium: row.medium,
        classification: row.classification,
        description: row.description,
        original_filename: row.original_filename,
        // Same-origin path the browser can render without credentials.
        imageUrl: assetId ? `/api/public-index/assets/${assetId}` : row.image_url,
      };
    })
    .filter((result): result is NonNullable<typeof result> => result !== null);
};

indexing.post('/jobs/:jobId/search', async (c) => {
  const job = await readJob(c.env.DB, c.req.param('jobId'));
  if (!job) {
    return c.json(jsonError('NOT_FOUND', 'Indexing job not found.'), 404);
  }

  let query = '';
  let topK = 20;
  try {
    const body = (await c.req.json()) as { query?: unknown; topK?: unknown };
    query = trimmedOrNull(body.query, 500) || '';
    const requestedTopK = Number(body.topK);
    if (Number.isFinite(requestedTopK)) {
      topK = Math.min(Math.max(Math.trunc(requestedTopK), 1), 50);
    }
  } catch {
    return c.json(jsonError('INVALID_INPUT', 'Invalid JSON request body.'), 400);
  }
  if (!query) {
    return c.json(jsonError('INVALID_INPUT', 'A search query is required.'), 400);
  }

  const jina = getJinaIndexConfig(c.env);
  const vectorize = getIndexVectorize(c.env);
  if (!jina.apiKey || !vectorize) {
    return c.json(
      jsonError('INDEX_SEARCH_UNAVAILABLE', 'Vector search is not configured.'),
      503
    );
  }

  // The /try flow and the search_artworks WebMCP tool reach indexed
  // collections through this route, so the LLM query interpreter must sit here
  // too — not only on /search/text. It degrades to the raw query on any
  // failure and is KV-cached after the first resolution of a query. The
  // deadline is generous because a Workers request cannot warm the cache in
  // the background after responding: whatever budget it gets here is all it
  // ever gets, so an abort-at-1.5s would mean interpreting never succeeds.
  const intent = await resolveIndexedQueryIntent(
    c.env,
    job.collection_id,
    query,
    c.req.raw.signal,
    8000
  );
  const effectiveQuery = intent?.rewrittenQuery || query;
  const hasFilters = Boolean(
    intent &&
      (intent.filters.artist ||
        intent.filters.medium ||
        intent.filters.classification ||
        intent.filters.yearFrom !== undefined ||
        intent.filters.yearTo !== undefined)
  );
  // Over-fetch when filters will cull candidates, so a filtered page still
  // returns topK results rather than a filtered fraction of topK.
  const candidateTopK = hasFilters ? Math.min(topK * 3, 100) : topK;

  let matches: Array<{ id: string; score: number }>;
  try {
    // The query side reuses the shared search helper so indexed collections
    // are queried exactly the way the rest of Paillette is.
    const queryEmbedding = await generateJinaQueryEmbedding(
      jina.apiKey,
      effectiveQuery,
      jina.model,
      jina.dimensions
    );
    const result = await vectorize.query(queryEmbedding, {
      topK: candidateTopK,
      filter: { galleryId: WEBMCP_INDEX_ORG_ID, indexJobId: job.id },
      returnValues: false,
      returnMetadata: 'indexed',
    });
    matches = result.matches.map((match) => ({ id: match.id, score: match.score }));
  } catch (error) {
    console.warn('Indexed collection search failed:', error);
    return c.json(
      jsonError('INDEX_SEARCH_FAILED', 'Search over the indexed collection failed.'),
      502
    );
  }

  if (matches.length === 0) {
    return c.json({
      success: true,
      data: { jobId: job.id, collectionId: job.collection_id, query, results: [] },
    });
  }

  const results = await hydrateIndexedMatches(c.env.DB, matches);

  // Intent filters cull after scoring, preserving vector rank order; the
  // page is then cut back to topK so filtered searches behave like plain
  // ones from the caller's point of view.
  let filteredResults =
    intent && hasFilters
      ? results
          .filter((result) =>
            artworkMatchesIntentFilters(
              {
                artist: result.artist,
                year: result.year,
                metadata: {
                  medium: result.medium,
                  classification: result.classification,
                },
              },
              intent.filters
            )
          )
          .slice(0, topK)
      : results;

  // The suggestions this collection offers are generated from its own
  // catalogue, so a suggested search that returns nothing is a broken promise.
  // Top up from D1 whenever the filtered vector page came back short, keeping
  // the vector-ranked hits first.
  if (intent && hasFilters && filteredResults.length < topK) {
    const seen = new Set(filteredResults.map((result) => result.id));
    const supplement = await queryIndexedByFilters(
      c.env.DB,
      job.collection_id,
      intent.filters,
      topK
    );
    for (const row of supplement) {
      if (filteredResults.length >= topK) break;
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      filteredResults.push(row);
    }
  }

  return c.json({
    success: true,
    data: {
      jobId: job.id,
      collectionId: job.collection_id,
      query,
      results: filteredResults,
      ...(intent
        ? {
            interpretation: {
              parserVersion: 'llm-intent-v1' as const,
              filters: intent.filters,
              rewrittenQuery: intent.rewrittenQuery,
              rationale: intent.rationale,
            },
          }
        : {}),
    },
  });
});

/**
 * POST /public-index/jobs/:jobId/image
 *
 * Visual search scoped to the collection this job built — the counterpart to
 * `/jobs/:jobId/search`, and what `search_by_image` needs when the human is
 * looking at a collection they indexed on this page rather than at a published
 * one. It works because index-time image vectors and a query-side image
 * embedding share a single jina-clip space (see `generateIndexEmbedding`):
 * "more like this" is the same Vectorize query with an image on the query
 * side instead of a sentence.
 */
indexing.post('/jobs/:jobId/image', async (c) => {
  const job = await readJob(c.env.DB, c.req.param('jobId'));
  if (!job) {
    return c.json(jsonError('NOT_FOUND', 'Indexing job not found.'), 404);
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json(
      jsonError('INVALID_INPUT', 'Expected multipart form data with an "image" part.'),
      400
    );
  }

  // workers-types declares FormData values as strings; at runtime an uploaded
  // part is a File, so identify it structurally exactly as `/items` does.
  const image = [form.get('image') as unknown].find(
    (value): value is File =>
      typeof value === 'object' &&
      value !== null &&
      typeof (value as File).arrayBuffer === 'function'
  );
  if (!image) {
    return c.json(jsonError('INVALID_INPUT', 'An "image" file part is required.'), 400);
  }
  if (image.size === 0) {
    return c.json(jsonError('INVALID_INPUT', 'The "image" part was empty.'), 400);
  }
  if (image.size > INDEXING_CAPS.maxFileBytes) {
    return c.json(
      jsonError(
        'IMAGE_TOO_LARGE',
        `Image search accepts files up to ${Math.round(INDEXING_CAPS.maxFileBytes / (1024 * 1024))}MB.`
      ),
      413
    );
  }
  // The same set indexing accepts, so a query image is never rejected for a
  // format the collection itself was built from.
  if (!inferMimeType(image.name || 'query', image.type)) {
    return c.json(
      jsonError(
        'IMAGE_TYPE_UNSUPPORTED',
        `Image search accepts ${[...INDEXABLE_MIME_TYPES].join(', ')}.`
      ),
      400
    );
  }

  const requestedTopK = Number(form.get('topK'));
  const topK = Number.isFinite(requestedTopK)
    ? Math.min(Math.max(Math.trunc(requestedTopK), 1), 50)
    : 20;
  const requestedMinScore = Number(form.get('minScore'));
  const minScore = Number.isFinite(requestedMinScore)
    ? Math.min(Math.max(requestedMinScore, 0), 1)
    : 0;

  const jina = getJinaIndexConfig(c.env);
  const vectorize = getIndexVectorize(c.env);
  if (!jina.apiKey || !vectorize) {
    return c.json(
      jsonError('INDEX_SEARCH_UNAVAILABLE', 'Vector search is not configured.'),
      503
    );
  }

  let matches: Array<{ id: string; score: number }>;
  try {
    const buffer = await image.arrayBuffer();
    const queryEmbedding = await generateIndexEmbedding(
      jina.apiKey,
      { image: arrayBufferToBase64(buffer) },
      jina.model,
      jina.dimensions,
      c.req.raw.signal
    );
    const result = await vectorize.query(queryEmbedding, {
      topK,
      filter: { galleryId: WEBMCP_INDEX_ORG_ID, indexJobId: job.id },
      returnValues: false,
      returnMetadata: 'indexed',
    });
    matches = result.matches.map((match) => ({ id: match.id, score: match.score }));
  } catch (error) {
    console.warn('Indexed collection image search failed:', error);
    return c.json(
      jsonError(
        'INDEX_IMAGE_SEARCH_FAILED',
        'Visual search over the indexed collection failed.'
      ),
      502
    );
  }

  const results = (await hydrateIndexedMatches(c.env.DB, matches)).filter(
    (result) => result.similarity >= minScore
  );

  return c.json({
    success: true,
    data: { jobId: job.id, collectionId: job.collection_id, results },
  });
});

/**
 * Resolve the LLM query intent for an indexed-collection search. Both the
 * inventory fetch and the resolution are fail-open: any error simply means
 * the search runs on the raw query, exactly as it did before the interpreter
 * existed.
 */
const resolveIndexedQueryIntent = async (
  env: Env,
  collectionId: string,
  query: string,
  signal: AbortSignal | undefined,
  timeoutMs?: number
): Promise<QueryIntent | null> => {
  try {
    const inventory = await getCollectionMetadataInventory(
      env.DB,
      collectionId
    );
    return await resolveQueryIntent(env, {
      collectionId,
      query,
      inventory: inventory ?? undefined,
      signal,
      timeoutMs,
    });
  } catch {
    return null;
  }
};

/**
 * GET /public-index/assets/:assetId
 * Serve an indexed image. Scoped to the sandbox org, so it can never become a
 * read path for NGA/NGS assets.
 */
indexing.get('/assets/:assetId', async (c) => {
  const assetId = c.req.param('assetId');
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(assetId)) {
    return c.json(jsonError('INVALID_INPUT', 'Invalid asset ID.'), 400);
  }

  const asset = await c.env.DB.prepare(
    'SELECT object_key, mime_type FROM assets WHERE id = ? AND org_id = ?'
  )
    .bind(assetId, WEBMCP_INDEX_ORG_ID)
    .first<{ object_key: string; mime_type: string | null }>();
  if (!asset) {
    return c.json(jsonError('NOT_FOUND', 'Asset not found.'), 404);
  }

  const object = await c.env.IMAGES.get(asset.object_key);
  if (!object) {
    return c.json(jsonError('NOT_FOUND', 'Asset not found.'), 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=3600');
  if (asset.mime_type) headers.set('Content-Type', asset.mime_type);
  return new Response(object.body, { headers });
});

export default indexing;
