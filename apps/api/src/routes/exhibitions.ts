/**
 * An exhibition with an address of its own.
 *
 * The board used to die with the tab, then it travelled in the URL, and both
 * were honest attempts at the same promise. The URL version works — it is
 * still here as a fallback — but it pays for statelessness twice: the hang is
 * capped at whatever a messaging client will carry, and the link is kilobytes
 * of base64 that nobody reads as a link. A full 24-work hang encodes to about
 * **3,280 characters** — the curation lane re-measured this against real
 * `write_labels` output after an earlier estimate of ~1,900 turned out to have
 * been taken against fixture labels a third the length of the real ones. This
 * route stores the show and hands back seven characters.
 *
 * Anonymous, like the rest of the NGA surface, which is the constraint that
 * shapes everything below. There is no account to hang the show off and no
 * curator identity to check on read, so:
 *
 *  - **The code is the capability.** Holding it opens the show; that is what a
 *    link is. It is unguessable, which is not the same as private, and the
 *    report says so in those words.
 *  - **Every work is checked against the catalogue before the row is written.**
 *    Not to be strict — because a stored show whose ids do not resolve is a
 *    404 that arrives days later, in front of whoever the curator sent it to.
 *  - **The prose is capped and the writes are rated.** This is a route that
 *    lets a stranger publish text under this domain. Caps and a per-caller
 *    hourly budget are what is available tonight; they bound the blast radius
 *    without pretending to be moderation, which this does not have.
 */

import { Hono } from 'hono';
import {
  generateShareCode,
  readShareCode,
  shareCodePath,
} from '@paillette/types/share-codes';
import type { Env } from '../index';
import { OPEN_ACCESS_ORG_ID, resolveOpenAccessProviderScope } from '../utils/orgs';

/**
 * Two boards' worth. The same number the in-page hang enforces — a show
 * assembled over several deals is not truncated, and the page stays a page.
 */
export const EXHIBITION_MAX_WORKS = 24;

/** Museum discipline, enforced rather than requested. */
export const TITLE_MAX_CHARS = 90;
export const STATEMENT_MAX_CHARS = 800;
export const LABEL_MAX_CHARS = 320;

/** A region's name. The same ceiling the board's own `annotate_atlas` uses. */
export const REGION_LABEL_MAX_CHARS = 60;

/**
 * More than this and an arrangement stops being an argument.
 *
 * The atlas tool says two to four regions read and six is the most it can
 * carry legibly; the walkable view turns each one into a room, and a
 * twelve-room enfilade for a twenty-four work show is a corridor.
 */
export const MAX_REGIONS = 6;

/**
 * A curator revising a show republishes it a few times; twenty an hour is
 * generous for that and useless as a way to fill a table with someone else's
 * prose.
 */
export const MAX_EXHIBITIONS_PER_CLIENT_PER_HOUR = 20;

/**
 * Codes are drawn at random from a keyspace of ~2 × 10^12, so a collision is
 * not something to plan a retry loop around — but a `UNIQUE` violation that
 * surfaces as a 500 in front of a curator who just wrote a show is, so it
 * retries. Five is far past the point where the loop means something is
 * genuinely wrong rather than unlucky.
 */
const CODE_ATTEMPTS = 5;

type ExhibitionRow = {
  code: string;
  collection_id: string;
  title: string | null;
  statement: string | null;
  title_by_agent: number;
  statement_by_agent: number;
  works: string;
  created_at: string;
  view_count: number;
};

export interface ExhibitionWork {
  artworkId: string;
  label: string | null;
  labelByAgent: boolean;
}

/**
 * A named grouping of works. The walkable view turns each one into a room.
 *
 * Stored *inside* the existing `works` column rather than beside it, which is
 * the reason this needed no migration. That column is TEXT holding JSON and
 * this route is its only writer, so a row can hold either shape:
 *
 *   `[ …works ]`                      — every row written before regions
 *   `{ "works": [ … ], "regions": [ … ] }`
 *
 * The reader accepts both and the writer only uses the object form when there
 * are regions to put in it, so nothing already published changes and a show
 * with no groupings is byte-for-byte what it was.
 */
export interface ExhibitionRegion {
  label: string;
  artworkIds: string[];
}

const jsonError = (code: string, message: string) => ({
  success: false as const,
  error: { code, message },
});

const asTrimmedString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const asBoolean = (value: unknown): boolean => value === true || value === 1;

/**
 * The same SHA-256-over-the-connecting-address shape the other anonymous paid
 * routes use. The raw address never reaches storage.
 */
const getClientHash = async (connectingIp: string | undefined) => {
  const candidate = asTrimmedString(connectingIp);
  if (!candidate || candidate.length > 45) return null;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`exhibitions:${candidate}`)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const withinCreateRateLimit = async (
  env: Env,
  clientHash: string | null
): Promise<boolean> => {
  if (!clientHash || !env.CACHE) return true;
  const bucket = Math.floor(Date.now() / 3_600_000);
  const key = `exhibitions:v1:${bucket}:${clientHash}`;
  try {
    const used = Number((await env.CACHE.get(key)) || '0');
    if (Number.isFinite(used) && used >= MAX_EXHIBITIONS_PER_CLIENT_PER_HOUR) {
      return false;
    }
    await env.CACHE.put(key, String((Number.isFinite(used) ? used : 0) + 1), {
      expirationTtl: 7200,
    });
    return true;
  } catch {
    // A cache that is down must not take publishing down with it.
    return true;
  }
};

/** Reading a stored hang. Tolerant, because this route is the only writer. */
const readHang = (raw: string): { works: ExhibitionWork[]; regions: ExhibitionRegion[] } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { works: [], regions: [] };
  }

  // Both shapes, so a row written before regions existed still reads.
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { works?: unknown })?.works)
      ? (parsed as { works: unknown[] }).works
      : [];
  const rawRegions = Array.isArray(parsed)
    ? []
    : Array.isArray((parsed as { regions?: unknown })?.regions)
      ? (parsed as { regions: unknown[] }).regions
      : [];

  const works: ExhibitionWork[] = [];
  for (const entry of list) {
    const artworkId = asTrimmedString((entry as { artworkId?: unknown })?.artworkId);
    if (!artworkId) continue;
    const label = asTrimmedString((entry as { label?: unknown })?.label);
    works.push({
      artworkId,
      label: label || null,
      labelByAgent: asBoolean((entry as { labelByAgent?: unknown })?.labelByAgent),
    });
  }

  /*
   * A region may only name works this exhibition actually hangs.
   *
   * Filtered on the way out as well as on the way in, because the column is
   * storage rather than a contract: a row edited by hand, or written by an
   * older version of this route, must not be able to make the page draw an
   * empty room or hang a work the show does not contain.
   */
  const hung = new Set(works.map((work) => work.artworkId));
  const regions: ExhibitionRegion[] = [];
  for (const entry of rawRegions) {
    const label = asTrimmedString((entry as { label?: unknown })?.label).slice(
      0,
      REGION_LABEL_MAX_CHARS
    );
    const ids = (entry as { artworkIds?: unknown })?.artworkIds;
    if (!label || !Array.isArray(ids)) continue;
    const artworkIds = ids
      .map((id) => asTrimmedString(id))
      .filter((id) => hung.has(id));
    if (artworkIds.length) regions.push({ label, artworkIds });
  }

  return { works, regions };
};

const toResponse = (row: ExhibitionRow) => {
  const { works, regions } = readHang(row.works);
  return {
    code: row.code,
    path: shareCodePath(row.code),
    collectionId: row.collection_id,
    title: row.title,
    titleByAgent: row.title_by_agent === 1,
    statement: row.statement,
    statementByAgent: row.statement_by_agent === 1,
    works,
    // Omitted rather than sent empty, so a show with no groupings looks
    // exactly as it did before regions existed.
    ...(regions.length ? { regions } : {}),
    createdAt: row.created_at,
    viewCount: row.view_count,
  };
};

const exhibitions = new Hono<{ Bindings: Env }>();

exhibitions.post('/public-exhibitions', async (c) => {
  c.header('Cache-Control', 'no-store');

  let body: {
    collectionId?: unknown;
    title?: unknown;
    titleByAgent?: unknown;
    statement?: unknown;
    statementByAgent?: unknown;
    works?: unknown;
    regions?: unknown;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json(jsonError('INVALID_INPUT', 'Invalid JSON request body.'), 400);
  }

  const collectionId = asTrimmedString(body.collectionId) || 'nga';
  // The open-access catalogue only. The page this code resolves to renders
  // NGA records against public IIIF URLs; a code pointing anywhere else would
  // store fine and then fail to render for the stranger it was sent to.
  if (resolveOpenAccessProviderScope(collectionId) !== 'nga') {
    return c.json(
      jsonError('NOT_FOUND', 'No publicly shareable collection with that id.'),
      404
    );
  }

  const requested = Array.isArray(body.works) ? body.works : [];
  if (requested.length === 0) {
    return c.json(
      jsonError('INVALID_INPUT', 'An exhibition needs at least one work.'),
      400
    );
  }
  if (requested.length > EXHIBITION_MAX_WORKS) {
    return c.json(
      jsonError('TOO_MANY_WORKS', `At most ${EXHIBITION_MAX_WORKS} works per exhibition.`),
      400
    );
  }

  // Order is part of what was asked for — a hang read out of order is a
  // different hang — so this keeps the caller's sequence and only drops
  // repeats, which are a mistake rather than an instruction.
  const seen = new Set<string>();
  const works: ExhibitionWork[] = [];
  for (const entry of requested) {
    const artworkId = asTrimmedString((entry as { artworkId?: unknown })?.artworkId);
    if (!artworkId || seen.has(artworkId)) continue;
    seen.add(artworkId);
    works.push({
      artworkId,
      label:
        asTrimmedString((entry as { label?: unknown })?.label).slice(
          0,
          LABEL_MAX_CHARS
        ) || null,
      labelByAgent: asBoolean((entry as { labelByAgent?: unknown })?.labelByAgent),
    });
  }
  if (!works.length) {
    return c.json(
      jsonError('INVALID_INPUT', 'An exhibition needs at least one work.'),
      400
    );
  }

  const clientHash = await getClientHash(c.req.header('CF-Connecting-IP'));
  if (!(await withinCreateRateLimit(c.env, clientHash))) {
    c.header('Retry-After', '600');
    return c.json(
      jsonError(
        'EXHIBITIONS_RATE_LIMITED',
        `Only ${MAX_EXHIBITIONS_PER_CLIENT_PER_HOUR} exhibitions may be published per hour. Try again later.`
      ),
      429
    );
  }

  // Every id is confirmed against the catalogue now, while the curator is
  // still here to see the answer, rather than at read time in front of
  // whoever they sent the link to.
  const placeholders = works.map(() => '?').join(', ');
  const found = await c.env.DB.prepare(
    `SELECT id FROM artworks
     WHERE org_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`
  )
    .bind(OPEN_ACCESS_ORG_ID, ...works.map((work) => work.artworkId))
    .all<{ id: string }>();

  const resolvable = new Set((found.results ?? []).map((row) => row.id));
  const hang = works.filter((work) => resolvable.has(work.artworkId));
  if (!hang.length) {
    return c.json(
      jsonError('ARTWORK_NOT_FOUND', 'None of those works are in this collection.'),
      404
    );
  }

  const title = asTrimmedString(body.title).slice(0, TITLE_MAX_CHARS) || null;
  const statement =
    asTrimmedString(body.statement).slice(0, STATEMENT_MAX_CHARS) || null;

  /*
   * Regions, resolved against the hang that survived rather than the one that
   * was asked for.
   *
   * A work the catalogue could not find has already been dropped from `hang`,
   * and a region still naming it would publish a room with a hole in it. A
   * region left with nothing at all is dropped entirely, because an empty
   * named room is a room the show does not have — the walkable view would
   * build four walls and hang nothing in them.
   *
   * A work claimed by two regions belongs to the first that claimed it. The
   * alternative is hanging the same picture twice, which is a lie about the
   * show, and this is the same rule the client-side planner applies.
   */
  const hungIds = new Set(hang.map((work) => work.artworkId));
  const claimed = new Set<string>();
  const regions: ExhibitionRegion[] = [];
  for (const entry of Array.isArray(body.regions) ? body.regions : []) {
    if (regions.length >= MAX_REGIONS) break;
    const label = asTrimmedString((entry as { label?: unknown })?.label).slice(
      0,
      REGION_LABEL_MAX_CHARS
    );
    const ids = (entry as { artworkIds?: unknown })?.artworkIds;
    if (!label || !Array.isArray(ids)) continue;
    const artworkIds: string[] = [];
    for (const raw of ids) {
      const artworkId = asTrimmedString(raw);
      if (!artworkId || !hungIds.has(artworkId) || claimed.has(artworkId)) continue;
      claimed.add(artworkId);
      artworkIds.push(artworkId);
    }
    if (artworkIds.length) regions.push({ label, artworkIds });
  }

  // The array form for a show with no groupings, byte-for-byte what every
  // row already stored looks like. Only a show that names its groups gets the
  // object, and `readHang` accepts both.
  const stored = regions.length ? JSON.stringify({ works: hang, regions }) : JSON.stringify(hang);

  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    const code = generateShareCode();
    try {
      await c.env.DB.prepare(
        `INSERT INTO exhibitions
           (code, collection_id, title, statement, title_by_agent, statement_by_agent, works)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          code,
          collectionId,
          title,
          statement,
          asBoolean(body.titleByAgent) ? 1 : 0,
          asBoolean(body.statementByAgent) ? 1 : 0,
          stored
        )
        .run();

      return c.json(
        {
          success: true as const,
          data: {
            code,
            path: shareCodePath(code),
            works: hang.length,
            ...(regions.length ? { regions: regions.length } : {}),
            // Said plainly rather than left for the curator to discover by
            // counting: a work that is not in the catalogue is not in the show.
            dropped: works.length - hang.length,
          },
        },
        201
      );
    } catch (error) {
      // A UNIQUE violation is the one error worth another draw. Anything else
      // will fail identically five times, so it stops here.
      const message = error instanceof Error ? error.message : String(error);
      if (!/UNIQUE|constraint/i.test(message)) {
        console.warn('exhibition insert failed:', error);
        return c.json(
          jsonError('EXHIBITION_NOT_SAVED', 'The exhibition could not be saved.'),
          502
        );
      }
    }
  }

  return c.json(
    jsonError('EXHIBITION_NOT_SAVED', 'The exhibition could not be saved.'),
    503
  );
});

exhibitions.get('/public-exhibitions/:code', async (c) => {
  const code = readShareCode(c.req.param('code'));
  // A malformed code and an unknown one are the same answer on purpose. There
  // is nothing to learn here about which codes exist.
  if (!code) {
    return c.json(jsonError('NOT_FOUND', 'No exhibition with that code.'), 404);
  }

  /*
   * Counting is opt-in, and the default is the honest one.
   *
   * This route resolves a code for three different callers — a human loading
   * the page, a social crawler building an unfurl card, and a probe asking
   * for JSON — and only the first is a visit. It used to count all three, so
   * pasting a link into Slack registered as somebody looking at the show.
   *
   * The web worker is the only layer that knows which caller it is, so it
   * says. Opt-in rather than opt-out because the failure modes are not
   * symmetric: a caller that forgets the flag under-counts, which is dull,
   * where a default of "count everything" means every new integration
   * silently inflates the number.
   */
  const counting = c.req.query('count') === '1';

  const row = await c.env.DB.prepare(
    `SELECT code, collection_id, title, statement, title_by_agent,
            statement_by_agent, works, created_at, view_count
     FROM exhibitions WHERE code = ?`
  )
    .bind(code)
    .first<ExhibitionRow>();

  if (!row) {
    return c.json(jsonError('NOT_FOUND', 'No exhibition with that code.'), 404);
  }

  if (counting) {
    // Counted after the response is decided, never in front of it. A visit
    // tally is not worth a millisecond of the page it is counting, and a
    // failed increment must not turn a working link into an error.
    const count = c.env.DB.prepare(
      'UPDATE exhibitions SET view_count = view_count + 1 WHERE code = ?'
    )
      .bind(code)
      .run()
      .catch((error: unknown) => {
        console.warn('exhibition view count failed:', error);
      });
    try {
      // Hono's `executionCtx` *throws* when there is no execution context
      // rather than returning undefined, so this cannot be an optional chain.
      // Off a Worker — in tests, and under `app.fetch` — the update simply
      // runs without anything holding the request open for it.
      c.executionCtx.waitUntil(count);
    } catch {
      // No execution context. The increment is already in flight.
    }
  }

  /*
   * Cacheable only when nobody is counting.
   *
   * These two cannot both be had: a response served from the edge never
   * reaches this Worker, so every cache hit is a visit that does not
   * increment. The crawler and probe paths want the cache and do not want the
   * count; the page load wants the count and can afford one indexed
   * primary-key lookup. So the header follows the flag rather than being the
   * same for everyone and quietly wrong for one of them.
   */
  c.header(
    'Cache-Control',
    counting ? 'no-store' : 'public, max-age=60, s-maxage=300'
  );
  return c.json({ success: true as const, data: toResponse(row) });
});

export default exhibitions;
