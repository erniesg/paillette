import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { loadArtworkDetailPage } from '~/lib/public-route-loaders.server';
import { getApiBaseUrl, getServerEnv } from '~/lib/public-search.server';
import { withWorkOSSession } from '~/lib/workos-auth.server';

export { default, meta } from './$orgId.artworks.$artworkId';

export const loader = (args: LoaderFunctionArgs) =>
  withWorkOSSession(args, (session) => {
    const { collectionId, artworkId } = args.params;
    return loadArtworkDetailPage({
      request: args.request,
      requestedOrgId: collectionId || '',
      artworkId: artworkId || '',
      routeScope: 'collection',
      accessToken: session.accessToken,
      apiBaseUrl: getApiBaseUrl(getServerEnv(args.context)),
    });
  });
