import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { loadPublicSearchPage } from '~/lib/public-route-loaders.server';

export { default, meta } from './galleries.$galleryId.search';

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { collectionId } = params;
  if (!collectionId) {
    throw new Response('Collection ID is required', { status: 400 });
  }

  return loadPublicSearchPage({
    request,
    requestedOrgId: collectionId,
    routeScope: 'collection',
  });
}
