/**
 * The three things that can be on the other end of a short link.
 *
 * Borrowed wholesale from the shape aether uses for its own short codes, which
 * is the right shape for a reason: `/e/:code` is not one resource, it is one
 * name for a resource that three very different clients want in three formats.
 *
 *  - a **social crawler** wants the `<head>` and will not run scripts
 *  - an **enrichment probe** wants the facts as JSON
 *  - a **human** wants the page
 *
 * The first two are answered here, ahead of the app, because both are cheap
 * and neither benefits from the router, the shell or the hydration payload.
 * Anything else returns null and falls through to Remix untouched — which is
 * the important property: this sits in front of every request the Worker
 * receives, so it must be uninteresting to all of them but these.
 */

import { readShareCode, shareCodePath } from '@paillette/types/share-codes';
import {
  isSocialCrawler,
  sharePreviewHtml,
  wantsJson,
  type SharePreview,
} from './preview';
import {
  buildExhibitionPage,
  loadExhibitionByCode,
} from '../exhibition-page.server';

/** `/e/:code`, and nothing that merely starts that way. */
const SHORT_LINK = /^\/e\/([^/]+)\/?$/;

export const readShortLinkCode = (pathname: string): string | null => {
  const match = SHORT_LINK.exec(pathname);
  if (!match) return null;
  try {
    return readShareCode(decodeURIComponent(match[1]!));
  } catch {
    // A malformed percent-escape is not a code.
    return null;
  }
};

/**
 * Answer a crawler or a probe, or return null to let the app handle it.
 *
 * Never throws. A failure here must fall through to Remix rather than turn a
 * working link into a 500 — the app can render the page perfectly well on its
 * own, and this path exists to make that faster, not to be load-bearing.
 */
export const handleShareRequest = async (
  request: Request,
  env: Record<string, string | undefined>
): Promise<Response | null> => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }

  const code = readShortLinkCode(url.pathname);
  if (!code) return null;

  const crawler = isSocialCrawler(request);
  const probe = wantsJson(request);
  // A human gets the app. This is the common case and costs one regex.
  if (!crawler && !probe) return null;

  try {
    const payload = await loadExhibitionByCode(code, env, request.signal);
    if (!payload) return null;

    const canonicalUrl = new URL(shareCodePath(code), url.origin).toString();
    const page = await buildExhibitionPage({
      payload,
      env,
      code,
      canonicalUrl,
      signal: request.signal,
    });
    if (!page) return null;

    if (probe) {
      return new Response(
        JSON.stringify({
          code: page.code,
          title: page.title,
          statement: page.statement,
          url: page.canonicalUrl,
          institution: page.institution,
          rights: page.rights,
          works: page.works.map((work) => ({
            id: work.artworkId,
            title: work.title,
            artist: work.artist,
            date: work.date,
            label: work.label,
            labelByAgent: work.labelByAgent,
            imageUrl: work.imageUrl,
            sourceUrl: work.sourceUrl,
          })),
        }),
        {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=60, s-maxage=300',
          },
        }
      );
    }

    const preview: SharePreview = {
      title: page.title,
      description: page.statement,
      imageUrl: page.works.find((work) => work.imageUrl)?.imageUrl ?? null,
      canonicalUrl: page.canonicalUrl,
      works: page.works.map((work) => ({
        title: work.title,
        artist: work.artist,
        imageUrl: work.imageUrl,
      })),
      institution: page.institution,
    };

    return new Response(sharePreviewHtml(preview), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Longer than the page's. An unfurl is cached by the chat client for
        // days anyway, and re-resolving it on every paste of the same link is
        // work nobody sees.
        'Cache-Control': 'public, max-age=300, s-maxage=3600',
      },
    });
  } catch {
    // Fall through to the app, which renders the same tags the slow way.
    return null;
  }
};
