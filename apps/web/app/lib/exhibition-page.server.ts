/**
 * Turning a share target into a page, whichever kind of link asked.
 *
 * There are two ways to name an exhibition now and there will only ever be one
 * renderer, so the resolution lives here rather than in either route:
 *
 *  - **`/e/:code`** — the show is a row in D1. The code carries no content, so
 *    the prose comes from the API and the catalogue supplies the records.
 *  - **`/exhibition?e=…`** — the whole show travels in the URL. Kept working
 *    because links of this shape are already in the world, and a share feature
 *    that breaks the links it previously handed out is worse than the problem
 *    it was fixing.
 *
 * Both converge on the same job: resolve every artwork id against the public
 * catalogue, on the server, before a pixel is sent. Ids are session-resolvable
 * inside the app; on a cold URL there is no session, so the catalogue is the
 * only thing that can say what these pictures are.
 */

import type { ExhibitionLinkPayload } from './exhibition-link';
import { getApiBaseUrl, resolvePublicSearchOrgId } from './public-search.server';

export interface HungWork {
  artworkId: string;
  title: string;
  artist: string | null;
  date: string | null;
  medium: string | null;
  accession: string | null;
  sourceUrl: string | null;
  imageUrl: string | null;
  label: string | null;
  labelByAgent: boolean;
}

export interface ExhibitionPage {
  title: string;
  statement: string | null;
  statementByAgent: boolean;
  works: HungWork[];
  /** Works the link asked for that the catalogue could not resolve. Reported. */
  missing: number;
  /** The short code, when this show has one. Null for a self-contained link. */
  code: string | null;
  /** Absolute, and the one a crawler and a `rel=canonical` should both see. */
  canonicalUrl: string;
  institution: string;
  institutionUrl: string;
  rights: string;
}

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/**
 * The institution's own public IIIF URL, not Paillette's asset URL.
 *
 * Paillette's `/assets/:id/content` needs a session, so it renders as a broken
 * image for exactly the visitor this page exists for. Open-access records
 * carry the source URL in their provenance blob; this is the same resolution
 * `artwork-summary.ts` does for the agent, for the same reason.
 */
const readImageUrl = (artwork: Record<string, unknown>): string | null => {
  const provenance = artwork.provenance;
  if (typeof provenance === 'string') {
    try {
      const parsed = JSON.parse(provenance) as { source_image_url?: unknown };
      const url = asText(parsed?.source_image_url);
      if (url && /^https?:\/\//i.test(url)) return url;
    } catch {
      // Not every collection stores provenance as JSON.
    }
  }
  const fallback = asText(artwork.image_url);
  return fallback && /^https?:\/\//i.test(fallback) ? fallback : null;
};

/** The API's root, without the `/api/v1` the versioned routes live under. */
const apiRoot = (env: Record<string, string | undefined>) =>
  getApiBaseUrl(env).replace(/\/api\/v1$/, '');

/**
 * How long any one upstream call gets before it is treated as absent.
 *
 * A hang is not a failure any of this code could previously see. Every fetch
 * here was unbounded, so a catalogue that accepted the connection and then
 * stopped talking would hold the whole page open — twenty-four concurrent
 * requests, all of them waiting, and a visitor watching a blank tab until
 * their browser gave up. Dropping one slow record and rendering the other
 * twenty-three is strictly better than rendering none of them late.
 */
export const RECORD_DEADLINE_MS = 4000;

/**
 * The crawler's budget is not ours to spend — and this one is a *total*.
 *
 * Slack, X and WhatsApp abandon an unfurl after a few seconds and cache the
 * empty result, so a preview that arrives in six seconds is not a slow
 * preview — it is a link that renders as a bare URL, and stays that way.
 *
 * The first version of this was 1500 ms applied *per fetch*, which was wrong
 * in both directions at once. The preview path makes two calls in sequence —
 * look the code up, then resolve the records — so the real worst case was
 * double the number written down. And measured against staging the lookup
 * alone ran 0.13–1.50 s, so it was tripping its own deadline on ordinary
 * traffic and silently falling through to the full app shell.
 *
 * So it is now one wall-clock cap on the whole path, not a per-call one.
 * 2.5 s total sits inside every unfurler's window with room to spare, and
 * `deadlineSignal` below is what makes it a real ceiling rather than an
 * aspiration.
 */
export const PREVIEW_DEADLINE_MS = 2500;

/**
 * One signal that fires after `ms`, folded together with the caller's own.
 *
 * Handed to every call on a path so the *path* has a deadline, rather than
 * each hop having its own and the total being however many hops there are.
 */
export const deadlineSignal = (
  ms: number,
  signal?: AbortSignal
): AbortSignal | undefined => {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') {
    return signal;
  }
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  return typeof AbortSignal.any === 'function'
    ? AbortSignal.any([signal, timeout])
    : timeout;
};

/**
 * `fetch` with a deadline, composed with the caller's own signal.
 *
 * `AbortSignal.any` and `AbortSignal.timeout` are both in the Workers runtime
 * and every current browser, but this also runs under jsdom in tests and in
 * older Node, so both are feature-detected rather than assumed. The manual
 * fallback is the same shape, and the timer is always cleared — an orphaned
 * `setTimeout` in a Worker keeps the isolate alive past the response.
 */
const fetchWithDeadline = async (
  url: string,
  { signal, deadlineMs, headers }: {
    signal?: AbortSignal;
    deadlineMs: number;
    headers?: Record<string, string>;
  }
): Promise<Response> => {
  const timeout =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(deadlineMs)
      : null;

  if (timeout && typeof AbortSignal.any === 'function') {
    return fetch(url, {
      headers,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  const relay = () => controller.abort();
  signal?.addEventListener('abort', relay, { once: true });
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
};

/**
 * A stored show, by its code.
 *
 * Returns null for anything that is not a live exhibition — a bad code, an
 * unknown one, an API that is down. The caller turns all of those into the
 * same 404, because from the visitor's side they are the same event: this
 * link does not open.
 */
export const loadExhibitionByCode = async (
  code: string,
  env: Record<string, string | undefined>,
  signal?: AbortSignal,
  deadlineMs: number = RECORD_DEADLINE_MS
): Promise<ExhibitionLinkPayload | null> => {
  try {
    const response = await fetchWithDeadline(
      `${apiRoot(env)}/api/public-exhibitions/${encodeURIComponent(code)}`,
      { signal, deadlineMs, headers: { Accept: 'application/json' } }
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      success?: boolean;
      data?: {
        collectionId?: string;
        title?: string | null;
        titleByAgent?: boolean;
        statement?: string | null;
        statementByAgent?: boolean;
        works?: { artworkId?: string; label?: string | null; labelByAgent?: boolean }[];
      };
    };
    const data = body?.success ? body.data : null;
    if (!data || !Array.isArray(data.works) || !data.works.length) return null;

    return {
      collectionId: data.collectionId || 'nga',
      title: asText(data.title),
      titleByAgent: data.titleByAgent === true,
      statement: asText(data.statement),
      statementByAgent: data.statementByAgent === true,
      works: data.works
        .filter((work) => typeof work?.artworkId === 'string' && work.artworkId.trim())
        .map((work) => ({
          artworkId: work.artworkId!.trim(),
          label: asText(work.label),
          labelByAgent: work.labelByAgent === true,
        })),
    };
  } catch {
    return null;
  }
};

/**
 * Every record, fetched by id, on the server, before anything is rendered.
 *
 * Concurrent because a hang is up to twenty-four works and doing them in
 * series would put a cold open somewhere north of a second for no reason.
 */
export const buildExhibitionPage = async ({
  payload,
  env,
  canonicalUrl,
  code = null,
  signal,
  deadlineMs = RECORD_DEADLINE_MS,
}: {
  payload: ExhibitionLinkPayload;
  env: Record<string, string | undefined>;
  canonicalUrl: string;
  code?: string | null;
  signal?: AbortSignal;
  deadlineMs?: number;
}): Promise<ExhibitionPage | null> => {
  const orgId = resolvePublicSearchOrgId(payload.collectionId);
  const base = getApiBaseUrl(env);

  const records = await Promise.all(
    payload.works.map(async (work) => {
      // Ids go in the path raw, deliberately. NGA ids look like
      // `open-access-art:nga:43632`, and the API's anonymous-read allowlist
      // matches `[^/%]+` — so a percent-encoded colon takes the request off
      // the public path and gets a 401 instead of the record. A slash or a
      // percent in an id would break the route, so those are refused here
      // rather than sent.
      if (/[/%]/.test(work.artworkId)) return null;
      try {
        const response = await fetchWithDeadline(
          `${base}/orgs/${orgId}/artworks/${work.artworkId}`,
          { signal, deadlineMs }
        );
        if (!response.ok) return null;
        const body = (await response.json()) as {
          success?: boolean;
          data?: Record<string, unknown>;
        };
        return body?.success && body.data ? body.data : null;
      } catch {
        // One unresolvable work must not take the exhibition down with it —
        // and since the deadline aborts into this same catch, neither can one
        // slow work. It drops out and is counted in `missing`.
        return null;
      }
    })
  );

  const works: HungWork[] = [];
  payload.works.forEach((work, index) => {
    const record = records[index];
    if (!record) return;
    works.push({
      artworkId: work.artworkId,
      title: asText(record.title) ?? 'Untitled',
      artist: asText(record.artist),
      date: asText(record.date_text) ?? (record.year ? String(record.year) : null),
      medium: asText(record.medium) ?? asText(record.classification),
      accession: asText(record.accession_number),
      sourceUrl: asText(record.source_url),
      imageUrl: readImageUrl(record),
      label: work.label,
      labelByAgent: work.labelByAgent,
    });
  });

  if (!works.length) return null;

  return {
    title: payload.title ?? 'Untitled',
    statement: payload.statement,
    statementByAgent: payload.statementByAgent,
    works,
    missing: payload.works.length - works.length,
    code,
    canonicalUrl,
    institution: 'National Gallery of Art, Washington',
    institutionUrl: 'https://www.nga.gov/open-access-images.html',
    // "CC0" is the curation lane's correction, carried across when the page
    // build moved out of the route. Naming the licence is the part a reuser
    // acts on; "open access" alone is a posture, not a permission.
    rights:
      'CC0 open access. The Gallery believes these works are in the public domain in the United States.',
  };
};
