import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { apiClient } from '~/lib/api';

export { default, meta } from './galleries.$galleryId.search';

export async function loader({ params }: LoaderFunctionArgs) {
  const { orgId } = params;
  if (!orgId) {
    throw new Response('Org ID is required', { status: 400 });
  }

  try {
    const gallery = await apiClient.getGallery(orgId);
    return {
      gallery,
      galleryId: gallery.id,
      preferredRouteId: gallery.slug || orgId,
    };
  } catch (error) {
    throw new Response('Gallery not found', { status: 404 });
  }
}
