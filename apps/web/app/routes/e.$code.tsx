/**
 * `/e/:code` — the short link.
 *
 * Seven characters, and the whole show is on the server. This is the link the
 * copy button hands out: short enough to read aloud, to fit in a slide, and to
 * survive a chat client that decides to shorten what it thinks is a long URL.
 *
 * The route is thin on purpose. It resolves a code to a payload and hands that
 * to the same builder and the same renderer `/exhibition?e=…` uses, because
 * two ways of naming an exhibition must not become two exhibition pages.
 *
 * Crawlers never get here. `worker.ts` answers them ahead of Remix with a
 * small preview document — see `~/lib/share/crawler.server` for why that is
 * worth a separate path rather than letting them parse the app shell.
 */

import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import { readShareCode, shareCodePath } from '@paillette/types/share-codes';
import {
  ExhibitionView,
  exhibitionMeta,
} from '~/components/exhibition/exhibition-view';
import {
  buildExhibitionPage,
  loadExhibitionByCode,
} from '~/lib/exhibition-page.server';
import {
  getServerEnv,
  isAllowedPublicSearchRouteId,
} from '~/lib/public-search.server';

export const loader = async ({ context, params, request }: LoaderFunctionArgs) => {
  // Validated before anything is fetched. A malformed code is not a lookup.
  const code = readShareCode(params.code);
  if (!code) throw new Response('Not found', { status: 404 });

  const env = getServerEnv(context);
  // The one caller that is a visit. Crawlers and probes are answered in
  // `worker.ts` before this loader runs and do not count.
  const payload = await loadExhibitionByCode(
    code,
    env,
    request.signal,
    undefined,
    true
  );
  if (!payload) throw new Response('Not found', { status: 404 });
  if (!isAllowedPublicSearchRouteId(payload.collectionId)) {
    throw new Response('Not found', { status: 404 });
  }

  const page = await buildExhibitionPage({
    payload,
    env,
    code,
    // Normalised rather than echoed: whatever punctuation the visitor's link
    // arrived wrapped in, the canonical URL is the clean one.
    canonicalUrl: new URL(shareCodePath(code), request.url).toString(),
    signal: request.signal,
  });
  if (!page) throw new Response('Not found', { status: 404 });

  return json(page, {
    headers: {
      /*
       * This governs the client-navigation `.data` request, not the document.
       *
       * `worker.ts` rewrites `Cache-Control` to `private, no-store` on
       * anything that asks for `text/html`, so a cold page load is never edge
       * cached whatever is set here — measured, and the header on the wire is
       * `private, no-store`. Which is the behaviour the visit count depends
       * on: a cached document would never reach the Worker and would never be
       * counted.
       *
       * Shorter than the self-contained link's anyway: that URL *is* its
       * record and can never change, while this one points at a row somebody
       * may republish.
       */
      'Cache-Control': 'public, max-age=60, s-maxage=300',
    },
  });
};

export const meta: MetaFunction<typeof loader> = ({ data }) =>
  exhibitionMeta(data ?? undefined);

export default function ShortExhibitionRoute() {
  return <ExhibitionView page={useLoaderData<typeof loader>()} />;
}
