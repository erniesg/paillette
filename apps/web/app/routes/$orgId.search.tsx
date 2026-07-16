import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { loadPublicSearchPage } from '~/lib/public-route-loaders.server';
import { getApiBaseUrl, getServerEnv } from '~/lib/public-search.server';
import { withWorkOSSession } from '~/lib/workos-auth.server';

export { default, meta } from './galleries.$galleryId.search';

export const loader = (args: LoaderFunctionArgs) =>
  withWorkOSSession(args, (session) => {
  const { orgId } = args.params;
  if (!orgId) {
    throw new Response('Org ID is required', { status: 400 });
  }

  return loadPublicSearchPage({
    requestedOrgId: orgId,
    routeScope: 'org',
    accessToken: session.accessToken,
    apiBaseUrl: getApiBaseUrl(getServerEnv(args.context)),
  });
});
