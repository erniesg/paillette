import {
  getApiClientForRequest,
  getKnownPublicOrg,
  getPreferredOrgRouteId,
  getPublicOrgDisplay,
  getPublicSearchRouteId,
  getPublicOrgRouteBasePath,
} from '~/lib/api';
import { isHiddenPublicNgsArtwork } from '~/lib/public-ngs-visibility';
import { getSafeSearchReturnPath } from '~/lib/search-result-sections';
import { getUpcomingSingaporeHolidaySuggestions } from '~/lib/singapore-holidays.server';

type PublicRouteScope = 'org' | 'collection';

export async function loadPublicSearchPage({
  request,
  requestedOrgId,
  routeScope,
}: {
  request: Request;
  requestedOrgId: string;
  routeScope: PublicRouteScope;
}) {
  if (!requestedOrgId) {
    throw new Response('Gallery ID is required', { status: 400 });
  }

  try {
    const knownPublicOrg = getKnownPublicOrg(requestedOrgId);
    const [gallery, holidaySuggestions] = await Promise.all([
      knownPublicOrg ??
        getApiClientForRequest(request).getGallery(requestedOrgId),
      getUpcomingSingaporeHolidaySuggestions(new Date(), {
        allowNetwork: false,
      }),
    ]);
    const displayGallery = getPublicOrgDisplay(gallery, requestedOrgId);
    const preferredRouteId = getPreferredOrgRouteId(
      requestedOrgId,
      gallery.slug
    );

    return {
      gallery: displayGallery,
      galleryId: gallery.id,
      publicSearchOrgId: getPublicSearchRouteId(requestedOrgId, gallery.id),
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
}: {
  request: Request;
  requestedOrgId: string;
  artworkId: string;
  routeScope: PublicRouteScope;
}) {
  if (!requestedOrgId || !artworkId) {
    throw new Response('Org ID and artwork ID are required', { status: 400 });
  }

  try {
    const api = getApiClientForRequest(request);
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
