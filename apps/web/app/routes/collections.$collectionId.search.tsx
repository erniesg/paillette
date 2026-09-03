import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json, redirect } from '@remix-run/cloudflare';
import { loadPublicSearchPage } from '~/lib/public-route-loaders.server';
import { getPublicCollection } from '~/lib/webmcp/collections';

export { default, meta } from './galleries.$galleryId.search';

const SEARCH_PAGE_CACHE_CONTROL =
  'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { collectionId } = params;
  if (!collectionId) {
    throw new Response('Collection ID is required', { status: 400 });
  }

  // This route resolves a collection UUID. A *public* collection id lands here
  // only from an old link — `/collections/nga/search` was published in earlier
  // docs and tool output — and used to 404. Send it to the page that actually
  // serves that collection, preserving the query so a shared search still
  // opens on its results.
  const publicCollection = getPublicCollection(collectionId);
  if (publicCollection) {
    const { search, hash } = new URL(request.url);
    throw redirect(`${publicCollection.searchPath}${search}${hash}`, 301);
  }

  const data = await loadPublicSearchPage({
    request,
    requestedOrgId: collectionId,
    routeScope: 'collection',
  });

  return json(data, {
    headers: {
      'Cache-Control': SEARCH_PAGE_CACHE_CONTROL,
    },
  });
}
