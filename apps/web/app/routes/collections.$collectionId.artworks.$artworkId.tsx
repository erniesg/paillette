import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { loadArtworkDetailPage } from '~/lib/public-route-loaders.server';

export { default, meta } from './$orgId.artworks.$artworkId';

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { collectionId, artworkId } = params;
  return loadArtworkDetailPage({
    request,
    requestedOrgId: collectionId || '',
    artworkId: artworkId || '',
    routeScope: 'collection',
  });
}
