import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { loadPublicSearchPage } from '~/lib/public-route-loaders.server';

export { default, meta } from './galleries.$galleryId.search';

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { orgId } = params;
  if (!orgId) {
    throw new Response('Org ID is required', { status: 400 });
  }

  return loadPublicSearchPage({
    request,
    requestedOrgId: orgId,
    routeScope: 'org',
  });
}
