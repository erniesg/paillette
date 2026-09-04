/**
 * `/exhibition?e=…` — the self-contained link, kept working.
 *
 * This was the first answer to "the board dies with the tab": deflate the
 * whole show into a query parameter and depend on no server state at all. It
 * works, and links of this shape are already in the world, so it stays. The
 * short code at `/e/:code` is the better link — no cap on the hang, and
 * something you can read out loud — but a share feature that breaks the links
 * it previously handed out is worse than the problem it was fixing.
 *
 * **Bare `/exhibition` used to 404,** which is what "`/exhibition` returns 404
 * on staging" turned out to be: not a deploy or routing fault, but this
 * route's own no-parameter branch. With no `e` there is no show, so it threw.
 * That is a defensible status code and a bad page — the person who reaches it
 * is someone whose link lost its query string in a chat client, and a dead end
 * tells them nothing. It redirects to the collection now, because a working
 * door beats an accurate error.
 *
 * The renderer itself lives in `~/components/exhibition/exhibition-view`, so
 * this route and `/e/:code` cannot drift into two different pages.
 */

import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/cloudflare';
import { json, redirect } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import {
  ExhibitionView,
  exhibitionMeta,
} from '~/components/exhibition/exhibition-view';
import {
  decodeExhibitionLink,
  EXHIBITION_LINK_PARAM,
} from '~/lib/exhibition-link';
import { buildExhibitionPage } from '~/lib/exhibition-page.server';
import {
  getServerEnv,
  isAllowedPublicSearchRouteId,
} from '~/lib/public-search.server';

export const loader = async ({ context, request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const encoded = url.searchParams.get(EXHIBITION_LINK_PARAM);
  if (!encoded) throw redirect('/nga/search');

  const payload = await decodeExhibitionLink(encoded);
  if (!payload) throw new Response('Not found', { status: 404 });
  if (!isAllowedPublicSearchRouteId(payload.collectionId)) {
    throw new Response('Not found', { status: 404 });
  }

  const page = await buildExhibitionPage({
    payload,
    env: getServerEnv(context),
    // The long link is its own canonical URL: this show was never stored
    // under a shorter name, so there is no better one to point at.
    canonicalUrl: url.toString(),
    signal: request.signal,
  });
  if (!page) throw new Response('Not found', { status: 404 });

  return json(page, {
    headers: {
      // The link is the record, so the answer for a given link never changes.
      'Cache-Control': 'public, max-age=300, s-maxage=86400',
    },
  });
};

export const meta: MetaFunction<typeof loader> = ({ data }) =>
  exhibitionMeta(data ?? undefined);

export default function ExhibitionRoute() {
  return <ExhibitionView page={useLoaderData<typeof loader>()} />;
}
