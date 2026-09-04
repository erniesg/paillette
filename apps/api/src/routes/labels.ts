/**
 * POST /api/public-labels — wall labels for a set of works, written against a
 * theme.
 *
 * The `write_labels` WebMCP tool's backend, and the reason the exhibition half
 * of this app is not decoration: **a wall label is contextual**. The same
 * painting in a show about weather and a show about grief does not get the
 * same label. If the text reads the same regardless of the statement, the
 * feature is fake, so the statement is not optional context here — it is the
 * brief the model is writing to, and the route says so at the top of the
 * prompt and again at the bottom.
 *
 * Two economies, both deliberate:
 *
 *  - **No vision.** `describe_artwork` already paid for a look at each picture
 *    and persisted the caption on the record. This route reads that caption
 *    out of D1 as raw material and never re-runs a vision call. A work with no
 *    caption still gets a label, written from the catalogue, and the response
 *    says which so nobody has to guess how well grounded it is.
 *  - **One call for the whole wall, not one per work.** Cheaper, and better:
 *    labels that were written together do not all open with the same clause,
 *    and the model can let one label carry what the next one need not repeat.
 *
 * Bounded like the other anonymous paid routes: the shared daily OpenAI
 * budget, a per-caller hourly cap, a hard ceiling on how many works one call
 * may label, and the open-access NGA collection only.
 */

import { Hono } from 'hono';
import type { Env } from '../index';
import { openaiCompletion } from '../utils/openai';
import { OPEN_ACCESS_ORG_ID, resolveOpenAccessProviderScope } from '../utils/orgs';
import { WEBMCP_INDEX_ORG_ID } from './indexing';

const LABEL_MODEL = 'gpt-5.6-terra';

/** The board is twelve. Labelling more than a board in one call is a mistake. */
export const MAX_LABELS_PER_CALL = 12;

/**
 * Two labelling calls an hour is a whole exhibition each; ten is rehearsal
 * room. Tighter than search, looser than vision, because this call costs one
 * completion for a wall rather than one per picture.
 */
export const MAX_LABEL_CALLS_PER_CLIENT_PER_HOUR = 10;

export const LABEL_MAX_CHARS = 320;
const STATEMENT_MAX_CHARS = 800;
const VOICE_MAX_CHARS = 200;

/**
 * Museum discipline, stated as constraints rather than as a request to be
 * brief. "One or two sentences" is the only length rule a wall label has, and
 * every clause below exists because a model left to itself writes a paragraph
 * of art-historical throat-clearing instead.
 */
const SYSTEM_PROMPT = [
  'You write wall labels for an exhibition.',
  'You are given the exhibition statement and a list of works. Write one label per work.',
  'A label is ONE or TWO sentences. Never three. Never a paragraph.',
  'The label is about this work IN THIS EXHIBITION. Say what this particular work is doing for this particular theme — the same painting in a show about weather and a show about grief does not get the same label.',
  'Ground every label in the evidence you are given: what the picture visibly shows, its title, its date, its medium. Never invent a subject, a sitter, an event or an intention that is not in the evidence.',
  'Never restate the exhibition statement. Never begin two labels the same way. Never open with "This work" or "Here,".',
  'Do not repeat the title, the artist or the date — they are already printed beside the label.',
  'Plain language. No "masterful", no "evokes", no "invites the viewer to".',
  'Respond with JSON of the shape {"labels": [{"artworkId": "...", "label": "..."}]} and nothing else. One entry per work you were given, in the order you were given them.',
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

/** Only Cloudflare's injected address separates anonymous callers. */
const getClientHash = async (connectingIp: string | undefined) => {
  const candidate = connectingIp?.trim();
  if (!candidate || candidate.length > 45) return null;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`webmcp-labels:${candidate}`)
  );
  return toHex(digest);
};

const withinLabelRateLimit = async (
  env: Env,
  clientHash: string | null
): Promise<boolean> => {
  if (!clientHash || !env.CACHE) return true;
  const bucket = Math.floor(Date.now() / 3_600_000);
  const key = `webmcp-labels:v1:${bucket}:${clientHash}`;
  try {
    const used = Number((await env.CACHE.get(key)) || '0');
    if (Number.isFinite(used) && used >= MAX_LABEL_CALLS_PER_CLIENT_PER_HOUR) {
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

type WorkRow = {
  id: string;
  title: string | null;
  artist: string | null;
  year: number | null;
  date_text: string | null;
  medium: string | null;
  classification: string | null;
  custom_metadata: string | null;
};

/** The caption `describe_artwork` already paid for, if there is one. */
export const readStoredCaption = (row: {
  custom_metadata: string | null;
}): string | null => {
  try {
    const metadata = JSON.parse(row.custom_metadata || '{}') as Record<
      string,
      unknown
    >;
    const caption = metadata.generated_caption as { text?: unknown } | undefined;
    const text = typeof caption?.text === 'string' ? caption.text.trim() : '';
    return text || null;
  } catch {
    return null;
  }
};

/**
 * What the model is shown for one work. Deliberately small: a caption and four
 * catalogue fields. Handing over the whole record invites the model to write
 * about provenance and credit lines, which is a catalogue entry, not a label.
 */
export const describeWorkForLabelling = (row: WorkRow) => {
  const caption = readStoredCaption(row);
  return {
    artworkId: row.id,
    title: row.title || 'Untitled',
    artist: row.artist || 'Unknown',
    date: row.date_text || (row.year ? String(row.year) : null),
    medium: row.medium || row.classification || null,
    ...(caption ? { visiblyShows: caption } : {}),
  };
};

const labels = new Hono<{ Bindings: Env }>();

labels.post('/public-labels', async (c) => {
  c.header('Cache-Control', 'no-store');
  const signal = c.req.raw.signal;

  let body: {
    collectionId?: unknown;
    artworkIds?: unknown;
    title?: unknown;
    statement?: unknown;
    voice?: unknown;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json(jsonError('INVALID_INPUT', 'Invalid JSON request body.'), 400);
  }

  const collectionId = asTrimmedString(body.collectionId);
  const artworkIds = Array.isArray(body.artworkIds)
    ? [...new Set(body.artworkIds.map(asTrimmedString).filter(Boolean))]
    : [];

  if (!collectionId || artworkIds.length === 0) {
    return c.json(
      jsonError('INVALID_INPUT', 'collectionId and a non-empty artworkIds are required.'),
      400
    );
  }
  if (artworkIds.length > MAX_LABELS_PER_CALL) {
    return c.json(
      jsonError(
        'TOO_MANY_WORKS',
        `At most ${MAX_LABELS_PER_CALL} works per call.`
      ),
      400
    );
  }

  const statement = asTrimmedString(body.statement).slice(0, STATEMENT_MAX_CHARS);
  if (!statement) {
    return c.json(
      jsonError(
        'NO_STATEMENT',
        'A label needs a theme to be a label. Write the exhibition statement first, then label against it.'
      ),
      400
    );
  }

  // Same collection scoping as describe: the open-access NGA collection, or a
  // collection this anonymous WebMCP flow built in the sandbox org.
  const ngaScope = resolveOpenAccessProviderScope(collectionId) === 'nga';
  if (!ngaScope) {
    const sandboxCollection = await c.env.DB.prepare(
      'SELECT 1 AS ok FROM index_jobs WHERE collection_id = ? AND org_id = ? LIMIT 1'
    )
      .bind(collectionId, WEBMCP_INDEX_ORG_ID)
      .first();
    if (!sandboxCollection) {
      return c.json(
        jsonError('NOT_FOUND', 'No publicly labellable collection with that id.'),
        404
      );
    }
  }

  const orgId = ngaScope ? OPEN_ACCESS_ORG_ID : WEBMCP_INDEX_ORG_ID;
  const placeholders = artworkIds.map(() => '?').join(', ');
  const query = await c.env.DB.prepare(
    `SELECT id, title, artist, year, date_text, medium, classification, custom_metadata
     FROM artworks
     WHERE org_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`
  )
    .bind(orgId, ...artworkIds)
    .all<WorkRow>();

  const byId = new Map((query.results ?? []).map((row) => [row.id, row]));
  // Keep the caller's order: the sequence is part of what they asked for, and
  // a hang read out of order is a different hang.
  const rows = artworkIds
    .map((id) => byId.get(id))
    .filter((row): row is WorkRow => Boolean(row));

  if (!rows.length) {
    return c.json(
      jsonError('ARTWORK_NOT_FOUND', 'None of those works are in this collection.'),
      404
    );
  }

  if (!c.env.OPENAI_API_KEY) {
    return c.json(
      jsonError(
        'LABELS_UNAVAILABLE',
        'Label writing is not configured on this deployment.'
      ),
      503
    );
  }

  const clientHash = await getClientHash(c.req.header('CF-Connecting-IP'));
  if (!(await withinLabelRateLimit(c.env, clientHash))) {
    c.header('Retry-After', '600');
    return c.json(
      jsonError(
        'LABELS_RATE_LIMITED',
        `Only ${MAX_LABEL_CALLS_PER_CLIENT_PER_HOUR} labelling calls may be made per hour. Try again later.`
      ),
      429
    );
  }

  const works = rows.map(describeWorkForLabelling);
  const title = asTrimmedString(body.title).slice(0, 120);
  const voice = asTrimmedString(body.voice).slice(0, VOICE_MAX_CHARS);

  const brief = [
    title ? `Exhibition title: ${title}` : null,
    `Exhibition statement: ${statement}`,
    voice ? `Voice: ${voice}` : null,
    `Works, in hanging order:\n${JSON.stringify(works, null, 1)}`,
    // Repeated at the end because it is the whole point and models weight the
    // last instruction heaviest.
    'Write one label per work, one or two sentences each, each one about what that work is doing for this exhibition.',
  ]
    .filter(Boolean)
    .join('\n\n');

  let written: { artworkId: string; label: string }[] = [];
  try {
    const payload = await openaiCompletion({
      env: c.env,
      model: LABEL_MODEL,
      json: true,
      // Twelve labels plus the reasoning the GPT-5.x family spends first.
      maxTokens: 2000,
      reasoningEffort: 'none',
      signal,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: brief },
      ],
    });
    const raw = (payload as { labels?: unknown }).labels;
    written = Array.isArray(raw)
      ? raw
          .map((entry) => ({
            artworkId: asTrimmedString((entry as { artworkId?: unknown })?.artworkId),
            label: asTrimmedString((entry as { label?: unknown })?.label).slice(
              0,
              LABEL_MAX_CHARS
            ),
          }))
          .filter((entry) => entry.artworkId && entry.label)
      : [];
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    console.warn('write_labels completion failed:', error);
    return c.json(
      jsonError(
        'LABELS_FAILED',
        'The label writer could not be reached. Try again shortly.'
      ),
      502
    );
  }

  const wanted = new Set(rows.map((row) => row.id));
  const kept = written.filter((entry) => wanted.has(entry.artworkId));
  if (!kept.length) {
    return c.json(
      jsonError('LABELS_FAILED', 'The label writer returned nothing usable.'),
      502
    );
  }

  const captioned = new Set(
    rows.filter((row) => readStoredCaption(row)).map((row) => row.id)
  );

  return c.json({
    success: true,
    data: {
      collectionId,
      model: LABEL_MODEL,
      labels: kept.map((entry) => ({
        ...entry,
        // Honest about how well grounded each label is: one written from a
        // vision caption saw the picture, one written from the catalogue did
        // not.
        source: captioned.has(entry.artworkId)
          ? ('caption' as const)
          : ('catalogue' as const),
      })),
      missing: artworkIds.filter(
        (id) => !kept.some((entry) => entry.artworkId === id)
      ),
    },
  });
});

export default labels;
