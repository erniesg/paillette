/**
 * POST /api/public-describe — assistive alt-text for one public artwork.
 *
 * The `describe_artwork` WebMCP tool's backend. Like the public-index routes,
 * it is deliberately anonymous: the demo runs in ChatGPT's in-app browser with
 * no account. Unlike those routes it spends a paid vision call, so it is
 * bounded three ways — the model is pinned to a small allowlist, each caller
 * gets a tighter hourly budget than indexing jobs, and the only collection it
 * will read is the open-access NGA one.
 *
 * The image is read from R2 bytes (the same objects the asset route streams)
 * and sent to the model as a data URL: a session-gated asset URL is useless to
 * the model, which fetches nothing. The caption is persisted on the artwork's
 * `custom_metadata.generated_caption` — the key the search corpus and the web
 * UI already read — and a stored caption is served from D1 without a model
 * call. Persisting is best-effort and never fails the response.
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import { openaiCompletion } from '../utils/openai';
import { OPEN_ACCESS_ORG_ID, resolveOpenAccessProviderScope } from '../utils/orgs';

export const DESCRIBE_MODELS = ['gpt-4o-mini', 'gpt-4o'] as const;
export type DescribeModel = (typeof DESCRIBE_MODELS)[number];
export const DEFAULT_DESCRIBE_MODEL: DescribeModel = 'gpt-4o-mini';

/**
 * Tighter than the 24/hour indexing-job budget: one vision call costs more
 * than one embedding. KV is best-effort, exactly as in indexing.ts.
 */
export const MAX_DESCRIBES_PER_CLIENT_PER_HOUR = 20;

const CAPTION_MAX_CHARS = 320;
const PROMPT_VERSION = 'describe-artwork-v1';

const SYSTEM_PROMPT = [
  'You write alt text for artworks.',
  'Describe only what is visibly depicted: the subject, the composition, the palette, and the visible medium.',
  'Write one or two sentences, at most 320 characters, in plain language that works when read aloud by a screen reader.',
  'Never speculate about the artist, the date, the provenance or the subject matter beyond what is visible; never mention prices or valuations.',
  'Respond with JSON of the shape {"caption": "..."} and nothing else.',
].join(' ');

const jsonError = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

const asTrimmedString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const toHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

/**
 * Only Cloudflare's injected connecting address can separate anonymous
 * visitors; a client-supplied header must never be substituted (same rule as
 * indexing.ts).
 */
const getClientHash = async (connectingIp: string | undefined) => {
  const candidate = connectingIp?.trim();
  if (!candidate || candidate.length > 45) return null;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`webmcp-describe:${candidate}`)
  );
  return toHex(digest);
};

const withinDescribeRateLimit = async (
  env: Env,
  clientHash: string | null
): Promise<boolean> => {
  if (!clientHash || !env.CACHE) return true;
  const bucket = Math.floor(Date.now() / 3_600_000);
  const key = `webmcp-describe:v1:${bucket}:${clientHash}`;
  try {
    const used = Number((await env.CACHE.get(key)) || '0');
    if (Number.isFinite(used) && used >= MAX_DESCRIBES_PER_CLIENT_PER_HOUR) {
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

/** Chunked so a multi-megabyte image cannot blow the call stack in one spread. */
const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

type ArtworkRow = {
  id: string;
  org_id: string;
  image_url: string | null;
  custom_metadata: string | null;
};

type AssetRow = {
  storage_provider: 'r2' | 'external';
  object_key: string;
  url: string | null;
  mime_type: string | null;
};

type StoredCaption = {
  text?: unknown;
  model?: unknown;
};

const readStoredCaption = (row: ArtworkRow): { text: string; model?: string } | null => {
  try {
    const metadata = JSON.parse(row.custom_metadata || '{}') as Record<string, unknown>;
    const caption = metadata.generated_caption as StoredCaption | undefined;
    const text = typeof caption?.text === 'string' ? caption.text.trim() : '';
    if (!text) return null;
    return {
      text,
      ...(typeof caption?.model === 'string' && caption.model ? { model: caption.model } : {}),
    };
  } catch {
    return null;
  }
};

/**
 * Resolve the image to model-visible bytes, following the same chain the asset
 * route serves: the original R2 object first, then the recorded external URL,
 * then the artwork's own image_url as a last resort.
 */
const loadImageDataUrl = async (
  env: Env,
  row: ArtworkRow,
  signal?: AbortSignal
): Promise<string | null> => {
  const asset = await env.DB.prepare(
    `SELECT storage_provider, object_key, url, mime_type
     FROM assets
     WHERE artwork_id = ? AND org_id = ?
     ORDER BY CASE role WHEN 'original' THEN 0 WHEN 'web' THEN 1 ELSE 2 END
     LIMIT 1`
  )
    .bind(row.id, row.org_id)
    .first<AssetRow>();

  if (asset && asset.storage_provider === 'r2') {
    const object = await env.IMAGES.get(asset.object_key);
    if (object) {
      const bytes = await object.arrayBuffer();
      const contentType =
        object.httpMetadata?.contentType || asset.mime_type || 'image/jpeg';
      return `data:${contentType};base64,${arrayBufferToBase64(bytes)}`;
    }
  }

  const candidates = [asset?.storage_provider === 'external' ? asset.url : null, row.image_url];
  for (const candidate of candidates) {
    const url = asTrimmedString(candidate);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) continue;
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength === 0) continue;
      const contentType =
        response.headers.get('content-type')?.split(';')[0] ||
        asset?.mime_type ||
        'image/jpeg';
      return `data:${contentType};base64,${arrayBufferToBase64(bytes)}`;
    } catch {
      // Try the next candidate; the model call is never made without bytes.
    }
  }
  return null;
};

const describe = new Hono<{ Bindings: Env }>();

describe.post('/public-describe', async (c) => {
  c.header('Cache-Control', 'no-store');
  const signal = c.req.raw.signal;

  let body: { collectionId?: unknown; artworkId?: unknown; model?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json(jsonError('INVALID_INPUT', 'Invalid JSON request body.'), 400);
  }

  const collectionId = asTrimmedString(body.collectionId);
  const artworkId = asTrimmedString(body.artworkId);
  if (!collectionId || !artworkId) {
    return c.json(
      jsonError('INVALID_INPUT', 'collectionId and artworkId are required.'),
      400
    );
  }

  // An anonymous caller never picks the bill: anything outside the allowlist
  // is refused before any database or model work happens.
  const requestedModel = asTrimmedString(body.model);
  if (requestedModel && !(DESCRIBE_MODELS as readonly string[]).includes(requestedModel)) {
    return c.json(
      jsonError(
        'INVALID_MODEL',
        `model must be one of: ${DESCRIBE_MODELS.join(', ')}.`
      ),
      400
    );
  }
  const model: DescribeModel = requestedModel
    ? (requestedModel as DescribeModel)
    : DEFAULT_DESCRIBE_MODEL;

  // Collection scoping: only the open-access NGA collection is readable here,
  // resolved to its immutable organisation ID exactly as public search does.
  if (resolveOpenAccessProviderScope(collectionId) !== 'nga') {
    return c.json(
      jsonError('NOT_FOUND', 'No publicly describable collection with that id.'),
      404
    );
  }

  const row = await c.env.DB.prepare(
    `SELECT id, org_id, image_url, custom_metadata
     FROM artworks
     WHERE id = ? AND org_id = ? AND deleted_at IS NULL`
  )
    .bind(artworkId, OPEN_ACCESS_ORG_ID)
    .first<ArtworkRow>();
  if (!row) {
    return c.json(
      jsonError('ARTWORK_NOT_FOUND', 'No such artwork in this collection.'),
      404
    );
  }

  // A stored caption answers without spending a model call.
  const stored = readStoredCaption(row);
  if (stored) {
    return c.json({
      success: true,
      data: {
        artworkId: row.id,
        collectionId,
        caption: stored.text,
        model: stored.model ?? model,
        cached: true,
        persisted: true,
      },
    });
  }

  if (!c.env.OPENAI_API_KEY) {
    return c.json(
      jsonError(
        'DESCRIBE_UNAVAILABLE',
        'Assistive descriptions are not configured on this deployment.'
      ),
      503
    );
  }

  const clientHash = await getClientHash(c.req.header('CF-Connecting-IP'));
  if (!(await withinDescribeRateLimit(c.env, clientHash))) {
    c.header('Retry-After', '600');
    return c.json(
      jsonError(
        'DESCRIBE_RATE_LIMITED',
        `Only ${MAX_DESCRIBES_PER_CLIENT_PER_HOUR} descriptions may be generated per hour. Try again later.`
      ),
      429
    );
  }

  const imageDataUrl = await loadImageDataUrl(c.env, row, signal);
  if (!imageDataUrl) {
    return c.json(
      jsonError(
        'ARTWORK_IMAGE_UNAVAILABLE',
        'This artwork has no readable image to describe.'
      ),
      404
    );
  }

  let caption = '';
  try {
    const payload = await openaiCompletion({
      env: c.env,
      model,
      json: true,
      maxTokens: 300,
      signal,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Write the alt text for this artwork.' },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
    });
    const raw = (payload as { caption?: unknown }).caption;
    caption = typeof raw === 'string' ? raw.trim().slice(0, CAPTION_MAX_CHARS) : '';
  } catch (error) {
    // A cancelled call is not an error to report — the caller is gone.
    if (error instanceof Error && error.name === 'AbortError') throw error;
    console.warn('describe_artwork completion failed:', error);
    return c.json(
      jsonError(
        'DESCRIBE_FAILED',
        'The description model could not be reached. Try again shortly.'
      ),
      502
    );
  }
  if (!caption) {
    return c.json(
      jsonError('DESCRIBE_FAILED', 'The description model returned no caption.'),
      502
    );
  }

  // Persisting is best-effort: the caller asked for text, not a write, so a
  // failed update degrades to persisted:false instead of an error.
  let persisted = true;
  try {
    let metadata: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.custom_metadata || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      }
    } catch {
      // Unreadable metadata is replaced rather than inherited.
    }
    metadata.generated_caption = {
      text: caption,
      model,
      prompt_version: PROMPT_VERSION,
      generated_at: new Date().toISOString(),
    };
    await c.env.DB.prepare(
      `UPDATE artworks SET custom_metadata = ?, updated_at = datetime('now')
       WHERE id = ? AND org_id = ?`
    )
      .bind(JSON.stringify(metadata), row.id, row.org_id)
      .run();
  } catch (error) {
    console.warn('describe_artwork persist failed:', error);
    persisted = false;
  }

  return c.json({
    success: true,
    data: {
      artworkId: row.id,
      collectionId,
      caption,
      model,
      cached: false,
      persisted,
    },
  });
});

export default describe;
