import {
  json,
  type HeadersFunction,
  type LoaderFunctionArgs,
} from '@remix-run/cloudflare';
import { getPublicSearchRouteId } from '~/lib/api';
import { loadPublicSearchPage } from '~/lib/public-route-loaders.server';
import { getSearchSpotlightPath } from '~/lib/search-spotlights';

export { default, meta } from './galleries.$galleryId.search';

export const headers: HeadersFunction = ({ loaderHeaders, parentHeaders }) => {
  const responseHeaders = new Headers(parentHeaders);
  const preload = loaderHeaders.get('Link');
  if (preload) responseHeaders.append('Link', preload);
  return responseHeaders;
};

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { orgId } = params;
  if (!orgId) {
    throw new Response('Org ID is required', { status: 400 });
  }

  const data = await loadPublicSearchPage({
    request,
    requestedOrgId: orgId,
    routeScope: 'org',
  });
  const publicSearchOrgId = getPublicSearchRouteId(orgId, data.galleryId);

  return json(
    {
      ...data,
      publicSearchOrgId,
    },
    {
      headers:
        publicSearchOrgId === 'nga'
          ? {
              Link: `<${getSearchSpotlightPath('nga')}>; rel=preload; as=fetch; crossorigin`,
            }
          : undefined,
    }
  );
}
