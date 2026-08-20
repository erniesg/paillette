import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { loadPublicSearchPage } from '~/lib/public-route-loaders.server';

export { default, meta } from './galleries.$galleryId.search';

const SEARCH_PAGE_CACHE_CONTROL =
  'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { collectionId } = params;
  if (!collectionId) {
    throw new Response('Collection ID is required', { status: 400 });
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
