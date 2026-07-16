import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { loadPublicSearchPage } from '~/lib/public-route-loaders.server';
import { getApiBaseUrl, getServerEnv } from '~/lib/public-search.server';
import { withWorkOSSession } from '~/lib/workos-auth.server';

export { default, meta } from './galleries.$galleryId.search';

export const loader = (args: LoaderFunctionArgs) =>
  withWorkOSSession(args, (session) => {
    const { collectionId } = args.params;
    if (!collectionId) {
      throw new Response('Collection ID is required', { status: 400 });
    }

    return loadPublicSearchPage({
      requestedOrgId: collectionId,
      routeScope: 'collection',
      accessToken: session.accessToken,
      apiBaseUrl: getApiBaseUrl(getServerEnv(args.context)),
    });
  });
