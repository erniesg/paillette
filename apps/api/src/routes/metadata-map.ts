/**
 * POST /api/public-index/metadata-map — LLM fallback for CSV sidecar headers
 * the deterministic aliases in apps/web/app/lib/indexing-client.ts cannot map.
 *
 * The browser sends only header names and up to three sample rows, never the
 * CSV itself and never an API key: OPENAI_API_KEY stays server-side. The
 * client treats any failure as "no learning available" and falls back to the
 * deterministic parse, so this being down must never fail an upload.
 *
 * Anonymous like the rest of /public-index (see the header comment in
 * indexing.ts), rate limited per IP through the same limiter but much harder:
 * every call costs an OpenAI completion.
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import { openaiCompletion } from '../utils/openai';
import { getClientHash, withinJobRateLimit } from './indexing';

/** One mapped header-set per session is the client's behaviour; this is the abuse backstop. */
export const METADATA_MAP_MAX_PER_HOUR = 10;

export const METADATA_MAP_MAX_HEADERS = 40;
export const METADATA_MAP_MAX_SAMPLES = 3;
export const METADATA_MAP_MAX_CELL_LENGTH = 120;

/** Everything the mapping may name: ItemMetadata fields plus the specials. */
export const METADATA_MAP_TARGETS = [
  'title',
  'artist',
  'year',
  'date_text',
  'medium',
  'classification',
  'description',
  'credit_line',
  'accession_number',
  'filename',
  'ignore',
] as const;

const TARGET_SET = new Set<string>(METADATA_MAP_TARGETS);

const SYSTEM_PROMPT = `You map CSV column headers from artwork-collection sidecar files to canonical metadata fields for a searchable art archive.

Canonical target fields:
- title: the work's title
- artist: creator, maker or photographer
- year: a clean numeric year the work was made
- date_text: a date that is not a clean year (e.g. "c. 1890s", "Spring 1888")
- medium: materials or technique (e.g. "oil on canvas")
- classification: the kind of object (e.g. "painting", "drawing", "photograph")
- description: free-text notes, summary or abstract
- credit_line: credit, attribution or acquisition line
- accession_number: catalogue, inventory, object or reference number

Two special values:
- filename: the column holds the image file name each row describes
- ignore: the column carries nothing usable

Reply with JSON only, shaped {"mapping": {"<header>": "<target>"}}.
Use each input header string exactly as given as a key, cover every header exactly once, and choose the single best target. When unsure, choose "ignore".`;

export type ValidatedMetadataMapRequest = {
  headers: string[];
  samples: string[][];
};

/**
 * Pure validation for the request body. Returns the cleaned request or a
 * human-readable rejection reason.
 */
export const validateMetadataMapRequest = (
  body: unknown
): ValidatedMetadataMapRequest | string => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be a JSON object.';
  }
  const { headers, samples } = body as { headers?: unknown; samples?: unknown };

  if (!Array.isArray(headers)) return '"headers" must be an array of strings.';
  if (headers.length < 1 || headers.length > METADATA_MAP_MAX_HEADERS) {
    return `Provide between 1 and ${METADATA_MAP_MAX_HEADERS} headers.`;
  }
  if (!headers.every((header) => typeof header === 'string')) {
    return 'Every header must be a string.';
  }
  const cleanHeaders = (headers as string[]).map((header) => header.trim());
  if (cleanHeaders.some((header) => !header)) {
    return 'Headers must not be blank.';
  }

  if (samples === undefined) return { headers: cleanHeaders, samples: [] };
  if (!Array.isArray(samples)) return '"samples" must be an array of rows.';
  if (samples.length > METADATA_MAP_MAX_SAMPLES) {
    return `At most ${METADATA_MAP_MAX_SAMPLES} sample rows are allowed.`;
  }
  for (const row of samples) {
    if (!Array.isArray(row)) {
      return 'Each sample row must be an array of strings.';
    }
    if (row.length !== cleanHeaders.length) {
      return 'Each sample row must have exactly one cell per header.';
    }
    if (!row.every((cell) => typeof cell === 'string')) {
      return 'Every sample cell must be a string.';
    }
    if (row.some((cell) => (cell as string).length > METADATA_MAP_MAX_CELL_LENGTH)) {
      return `Each sample cell must be ${METADATA_MAP_MAX_CELL_LENGTH} characters or fewer.`;
    }
  }
  return { headers: cleanHeaders, samples: samples as string[][] };
};

/**
 * Force the model's answer onto the protocol: anything missing, misspelled or
 * out of vocabulary becomes "ignore" rather than being trusted.
 */
export const sanitizeHeaderMapping = (
  raw: unknown,
  headers: string[]
): Record<string, string> => {
  const source =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const byKey = new Map(
    Object.entries(source).map(([key, value]) => [key.trim().toLowerCase(), value])
  );

  const mapping: Record<string, string> = {};
  for (const header of headers) {
    const value = byKey.get(header.toLowerCase());
    const target = typeof value === 'string' ? value.trim().toLowerCase() : '';
    mapping[header] = TARGET_SET.has(target) ? target : 'ignore';
  }
  return mapping;
};

const metadataMap = new Hono<{ Bindings: Env }>();

metadataMap.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

metadataMap.post('/metadata-map', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { success: false as const, error: { code: 'INVALID_INPUT', message: 'Invalid JSON request body.' } },
      400
    );
  }

  const validated = validateMetadataMapRequest(body);
  if (typeof validated === 'string') {
    return c.json(
      { success: false as const, error: { code: 'INVALID_INPUT', message: validated } },
      400
    );
  }

  const clientHash = await getClientHash(c.req.header('CF-Connecting-IP'));
  const allowed = await withinJobRateLimit(c.env, clientHash, {
    keyPrefix: 'webmcp-metadata-map:v1',
    limitPerHour: METADATA_MAP_MAX_PER_HOUR,
  });
  if (!allowed) {
    c.header('Retry-After', '600');
    return c.json(
      {
        success: false as const,
        error: {
          code: 'METADATA_MAP_RATE_LIMITED',
          message: `Only ${METADATA_MAP_MAX_PER_HOUR} header mappings may be requested per hour. Try again later.`,
        },
      },
      429
    );
  }

  try {
    const result = await openaiCompletion({
      env: c.env,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            headers: validated.headers,
            samples: validated.samples,
          }),
        },
      ],
      json: true,
      maxTokens: 800,
    });

    const mapping = sanitizeHeaderMapping(
      (result as Record<string, unknown>).mapping,
      validated.headers
    );
    return c.json({ success: true as const, data: { mapping } });
  } catch (error) {
    // Missing key, provider outage, malformed answer — all the same to the
    // client: deterministic parsing was always good enough to proceed.
    console.warn('Metadata header mapping unavailable:', error);
    return c.json(
      {
        success: false as const,
        error: {
          code: 'MAPPING_UNAVAILABLE',
          message: 'Header mapping is not available right now.',
        },
      },
      503
    );
  }
});

export default metadataMap;
