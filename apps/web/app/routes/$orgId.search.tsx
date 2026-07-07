import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getApiClientForRequest, getPreferredOrgRouteId } from '~/lib/api';
import { getUpcomingSingaporeHolidaySuggestions } from '~/lib/singapore-holidays.server';

export { default, meta } from './galleries.$galleryId.search';

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { orgId } = params;
  if (!orgId) {
    throw new Response('Org ID is required', { status: 400 });
  }

  try {
    const [gallery, holidaySuggestions] = await Promise.all([
      getApiClientForRequest(request).getGallery(orgId),
      getUpcomingSingaporeHolidaySuggestions(new Date(), {
        allowNetwork: false,
      }),
    ]);
    return {
      gallery,
      galleryId: gallery.id,
      preferredRouteId: getPreferredOrgRouteId(orgId, gallery.slug),
      holidaySuggestions,
    };
  } catch (error) {
    throw new Response('Gallery not found', { status: 404 });
  }
}
