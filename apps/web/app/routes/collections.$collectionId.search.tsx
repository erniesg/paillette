import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getApiClientForRequest, getPreferredOrgRouteId } from '~/lib/api';
import { getUpcomingSingaporeHolidaySuggestions } from '~/lib/singapore-holidays.server';

export { default, meta } from './galleries.$galleryId.search';

export async function loader({ params, request }: LoaderFunctionArgs) {
  const { collectionId } = params;
  if (!collectionId) {
    throw new Response('Collection ID is required', { status: 400 });
  }

  try {
    const [gallery, holidaySuggestions] = await Promise.all([
      getApiClientForRequest(request).getGallery(collectionId),
      getUpcomingSingaporeHolidaySuggestions(),
    ]);

    return {
      gallery,
      galleryId: gallery.id,
      preferredRouteId: getPreferredOrgRouteId(collectionId, gallery.slug),
      holidaySuggestions,
    };
  } catch {
    throw new Response('Collection not found', { status: 404 });
  }
}
