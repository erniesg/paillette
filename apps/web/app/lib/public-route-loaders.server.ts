import {
  getApiClientForRequest,
  getPreferredOrgRouteId,
  getPublicOrgRouteBasePath,
} from '~/lib/api';
import { isHiddenPublicNgsArtwork } from '~/lib/public-ngs-visibility';
import { getSafeSearchReturnPath } from '~/lib/search-result-sections';
import { getUpcomingSingaporeHolidaySuggestions } from '~/lib/singapore-holidays.server';
import type { ApiResponse, Gallery } from '~/types';

type PublicRouteScope = 'org' | 'collection';

export async function loadPublicSearchPage({
  requestedOrgId,
  routeScope,
  accessToken,
  apiBaseUrl,
}: {
  requestedOrgId: string;
  routeScope: PublicRouteScope;
  accessToken?: string | null;
  apiBaseUrl?: string;
}) {
  if (!requestedOrgId) {
    throw new Response('Gallery ID is required', { status: 400 });
  }

  try {
    const lockedGallery: Gallery = {
      id: requestedOrgId,
      name:
        requestedOrgId.toLowerCase() === 'ngs'
          ? 'National Gallery Singapore'
          : requestedOrgId.toLowerCase() === 'open' ||
              requestedOrgId.toLowerCase() === 'nga'
            ? 'Open Access Art'
            : 'Paillette Collection',
      slug: requestedOrgId,
    } as Gallery;
    const galleryPromise =
      accessToken && apiBaseUrl
        ? fetch(`${apiBaseUrl}/orgs/${encodeURIComponent(requestedOrgId)}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          }).then(async (response) => {
            const payload = (await response.json()) as ApiResponse<Gallery>;
            if (!response.ok || !payload.success || !payload.data) {
              throw new Error('Gallery not found');
            }
            return payload.data;
          })
        : Promise.resolve(lockedGallery);
    const [gallery, holidaySuggestions] = await Promise.all([
      galleryPromise,
      getUpcomingSingaporeHolidaySuggestions(),
    ]);
    const preferredRouteId = getPreferredOrgRouteId(
      requestedOrgId,
      gallery.slug
    );

    return {
      gallery,
      galleryId: gallery.id,
      preferredRouteId,
      publicRouteBasePath: getPublicOrgRouteBasePath({
        requestedOrgId,
        preferredRouteId,
        canonicalSlug: gallery.slug,
        routeScope,
      }),
      holidaySuggestions,
    };
  } catch {
    throw new Response('Gallery not found', { status: 404 });
  }
}

export async function loadArtworkDetailPage({
  request,
  requestedOrgId,
  artworkId,
  routeScope,
  accessToken,
  apiBaseUrl,
}: {
  request: Request;
  requestedOrgId: string;
  artworkId: string;
  routeScope: PublicRouteScope;
  accessToken?: string | null;
  apiBaseUrl?: string;
}) {
  if (!requestedOrgId || !artworkId) {
    throw new Response('Org ID and artwork ID are required', { status: 400 });
  }
  if (!accessToken) {
    throw new Response('Sign in is required', { status: 401 });
  }

  try {
    const api = getApiClientForRequest(request, { accessToken, apiBaseUrl });
    const gallery = await api.getGallery(requestedOrgId);
    const artwork = await api.getArtwork(gallery.id, artworkId);
    const preferredRouteId = getPreferredOrgRouteId(
      requestedOrgId,
      gallery.slug
    );
    if (preferredRouteId === 'ngs' && isHiddenPublicNgsArtwork(artwork)) {
      throw new Response('Artwork not found', { status: 404 });
    }

    const url = new URL(request.url);
    const publicRouteBasePath = getPublicOrgRouteBasePath({
      requestedOrgId,
      preferredRouteId,
      canonicalSlug: gallery.slug,
      routeScope,
    });

    return {
      gallery,
      artwork,
      preferredRouteId,
      publicRouteBasePath,
      returnToSearchPath: getSafeSearchReturnPath(
        url.searchParams.get('from'),
        publicRouteBasePath
      ),
    };
  } catch {
    throw new Response('Artwork not found', { status: 404 });
  }
}
