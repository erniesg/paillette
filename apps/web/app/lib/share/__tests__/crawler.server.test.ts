/**
 * The branch in front of the app.
 *
 * This runs on every request the Worker receives, so the property that matters
 * most is not what it answers — it is what it *declines* to answer. A human on
 * a short link, a request for any other path, an API that is down: all of them
 * have to come back null and reach Remix untouched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleShareRequest, readShortLinkCode } from '../crawler.server';

const CODE = 'aB3xk9m';
const ORIGIN = 'https://paillette-stg.berlayar.ai';
const env = { APP_ENV: 'staging', PAILLETTE_API_URL: 'https://api.example' };

const SLACK = 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)';
const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

const exhibition = {
  success: true,
  data: {
    collectionId: 'nga',
    title: 'Leaving',
    titleByAgent: true,
    statement: 'A show about the moment before departure.',
    statementByAgent: false,
    works: [
      { artworkId: 'open-access-art:nga:138648', label: 'The boat is already gone.', labelByAgent: true },
    ],
  },
};

const record = {
  success: true,
  data: {
    title: 'Avalanche in an Alpine Landscape',
    artist: 'Pierre Puvis de Chavannes',
    date_text: 'c. 1870',
    medium: 'chalk on blue paper',
    accession_number: '1972.1.1',
    source_url: 'https://www.nga.gov/collection/art-object-page.138648.html',
    provenance: JSON.stringify({
      source_image_url: 'https://api.nga.gov/iiif/abc-123/full/full/0/default.jpg',
    }),
  },
};

/** Answers the exhibition lookup and the per-artwork lookups, nothing else. */
const stubApi = (overrides: { exhibition?: unknown; status?: number } = {}) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/public-exhibitions/')) {
      return new Response(
        JSON.stringify(overrides.exhibition ?? exhibition),
        { status: overrides.status ?? 200 }
      );
    }
    if (url.includes('/artworks/')) {
      return new Response(JSON.stringify(record), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

const request = (path: string, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, { headers });

beforeEach(() => {
  vi.stubGlobal('fetch', stubApi());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reading the path', () => {
  it('matches a short link and validates the code', () => {
    expect(readShortLinkCode(`/e/${CODE}`)).toBe(CODE);
    expect(readShortLinkCode(`/e/${CODE}/`)).toBe(CODE);
  });

  it.each([
    ['the exhibition route', '/exhibition'],
    ['the collection', '/nga/search'],
    ['a deeper path', `/e/${CODE}/extra`],
    ['a prefix that only looks like one', '/exports/thing'],
    ['the root', '/'],
    ['a bad code', '/e/abcdef0'],
    ['a traversal attempt', '/e/..'],
  ])('declines %s', (_name, path) => {
    expect(readShortLinkCode(path)).toBeNull();
  });

  it('survives a malformed percent-escape instead of throwing', () => {
    expect(readShortLinkCode('/e/%E0%A4%A')).toBeNull();
  });
});

describe('who gets what', () => {
  it('serves a crawler the preview document', async () => {
    const response = await handleShareRequest(
      request(`/e/${CODE}`, { 'User-Agent': SLACK }),
      env
    );
    expect(response).not.toBeNull();
    expect(response!.headers.get('Content-Type')).toContain('text/html');

    const html = await response!.text();
    expect(html).toContain('<meta property="og:title" content="Leaving"/>');
    expect(html).toContain(
      '<meta property="og:description" content="A show about the moment before departure."/>'
    );
    expect(html).toContain(
      `<meta property="og:url" content="${ORIGIN}/e/${CODE}"/>`
    );
    expect(html).toContain('/full/1200,/0/default.jpg');
    expect(html).toContain('summary_large_image');
    // The work resolved through the catalogue, not out of the stored row.
    expect(html).toContain('Avalanche in an Alpine Landscape');
  });

  /*
   * Neither of these is somebody looking at the show, so neither may bump the
   * visit tally. The API counts only when asked, and this asserts the crawler
   * path never asks — pasting a link into Slack is not a view of it.
   */
  it.each([
    ['a crawler', { 'User-Agent': SLACK }],
    ['a probe', { Accept: 'application/json' }],
  ])('does not count %s as a visit', async (_name, headers) => {
    await handleShareRequest(request(`/e/${CODE}`, headers), env);
    const lookups = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes('/public-exhibitions/'));
    expect(lookups).toHaveLength(1);
    expect(lookups[0]).not.toContain('count=1');
  });

  it('serves an enrichment probe the facts as JSON', async () => {
    const response = await handleShareRequest(
      request(`/e/${CODE}`, { Accept: 'application/json' }),
      env
    );
    expect(response!.headers.get('Content-Type')).toContain('application/json');

    const body = (await response!.json()) as {
      code: string;
      title: string;
      url: string;
      works: { title: string; label: string; labelByAgent: boolean }[];
    };
    expect(body.code).toBe(CODE);
    expect(body.title).toBe('Leaving');
    expect(body.url).toBe(`${ORIGIN}/e/${CODE}`);
    expect(body.works[0]!.title).toBe('Avalanche in an Alpine Landscape');
    expect(body.works[0]!.labelByAgent).toBe(true);
  });

  it('lets a human through to the app', async () => {
    const response = await handleShareRequest(
      request(`/e/${CODE}`, {
        'User-Agent': CHROME,
        Accept: 'text/html,application/xhtml+xml',
      }),
      env
    );
    expect(response).toBeNull();
    // And it did not spend a request finding that out.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores every path that is not a short link', async () => {
    for (const path of ['/', '/nga/search', '/exhibition?e=0abc', '/api/exhibitions']) {
      expect(
        await handleShareRequest(request(path, { 'User-Agent': SLACK }), env)
      ).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores a write, whatever it claims to be', async () => {
    const response = await handleShareRequest(
      new Request(`${ORIGIN}/e/${CODE}`, {
        method: 'POST',
        headers: { 'User-Agent': SLACK },
      }),
      env
    );
    expect(response).toBeNull();
  });
});

describe('when something is wrong', () => {
  it('falls through rather than 404ing a code the API does not know', async () => {
    vi.stubGlobal('fetch', stubApi({ status: 404 }));
    const response = await handleShareRequest(
      request(`/e/${CODE}`, { 'User-Agent': SLACK }),
      env
    );
    // Null, not a 404 document: the app renders its own 404, and this path is
    // an optimisation with a fallback rather than the authority on what exists.
    expect(response).toBeNull();
  });

  it('falls through when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused');
      })
    );
    await expect(
      handleShareRequest(request(`/e/${CODE}`, { 'User-Agent': SLACK }), env)
    ).resolves.toBeNull();
  });

  it('falls through when the show resolves to no works at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/public-exhibitions/')) {
          return new Response(JSON.stringify(exhibition), { status: 200 });
        }
        return new Response('{}', { status: 404 });
      })
    );
    await expect(
      handleShareRequest(request(`/e/${CODE}`, { 'User-Agent': SLACK }), env)
    ).resolves.toBeNull();
  });
});
