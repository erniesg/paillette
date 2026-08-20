import {
  json,
  type HeadersFunction,
  type LoaderFunctionArgs,
} from '@remix-run/cloudflare';
import { getPublicSearchRouteId } from '~/lib/api';
import { loadPublicSearchPage } from '~/lib/public-route-loaders.server';
import { getSearchSpotlightPath } from '~/lib/search-spotlights';

export { default, meta } from './galleries.$galleryId.search';

const SEARCH_PAGE_CACHE_CONTROL =
  'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

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
      headers: {
        'Cache-Control': SEARCH_PAGE_CACHE_CONTROL,
        ...(publicSearchOrgId === 'nga'
          ? {
              Link: `<${getSearchSpotlightPath('nga')}>; rel=preload; as=fetch; crossorigin`,
            }
          : {}),
      },
    }
  );
}
