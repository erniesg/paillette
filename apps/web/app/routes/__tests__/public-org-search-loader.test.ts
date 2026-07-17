import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getApiClientForRequest, getGallery, getPublicSearchRouteId } =
  vi.hoisted(() => {
    const getGallery = vi.fn();
    return {
      getGallery,
      getApiClientForRequest: vi.fn(() => ({ getGallery })),
      getPublicSearchRouteId: vi.fn(
        (_requestedOrgId, canonicalOrgId) => canonicalOrgId
      ),
    };
  });

vi.mock('~/lib/api', () => ({
  getApiClientForRequest,
  getKnownPublicOrg: vi.fn(() => ({
    id: 'ngs-org-id',
    name: 'National Gallery Singapore',
    slug: 'national-gallery-singapore',
  })),
  getPreferredOrgRouteBasePath: vi.fn(() => '/ngs'),
  getPreferredOrgRouteId: vi.fn(() => 'ngs'),
  getPublicOrgDisplay: vi.fn((gallery) => gallery),
  getPublicSearchRouteId,
  isLegacyOpenAccessRoute: vi.fn(() => false),
}));

vi.mock('~/lib/singapore-holidays.server', () => ({
  getUpcomingSingaporeHolidaySuggestions: vi.fn(async () => []),
}));

vi.mock('../galleries.$galleryId.search', () => ({
  default: () => null,
  meta: () => [],
}));

import { getSearchSpotlightPath } from '~/lib/search-spotlights';
import { headers, loader } from '../$orgId.search';

describe('public org search loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGallery.mockResolvedValue({
      id: 'ngs-org-id',
      name: 'National Gallery Singapore',
      slug: 'national-gallery-singapore',
    });
    getPublicSearchRouteId.mockImplementation(
      (_requestedOrgId, canonicalOrgId) => canonicalOrgId
    );
  });

  it('loads known public metadata without calling the protected org API', async () => {
    const response = await loader({
      context: {},
      params: { orgId: 'ngs' },
      request: new Request('http://localhost:5173/ngs/search'),
    } as any);

    expect(getApiClientForRequest).not.toHaveBeenCalled();
    expect(getGallery).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      galleryId: 'ngs-org-id',
      publicSearchOrgId: 'ngs-org-id',
    });
    expect(response.headers.get('Link')).toBeNull();
  });

  it('preloads the immutable spotlight bundle only for the NGA route', async () => {
    getPublicSearchRouteId.mockReturnValue('nga');

    const response = await loader({
      context: {},
      params: { orgId: 'nga' },
      request: new Request('http://localhost:5173/nga/search'),
    } as any);

    expect(response.headers.get('Link')).toBe(
      `<${getSearchSpotlightPath('nga')}>; rel=preload; as=fetch; crossorigin`
    );

    const documentHeaders = new Headers(
      headers({
        loaderHeaders: response.headers,
        parentHeaders: new Headers({ 'X-Parent': 'preserved' }),
      } as any)
    );
    expect(documentHeaders.get('Link')).toBe(response.headers.get('Link'));
    expect(documentHeaders.get('X-Parent')).toBe('preserved');
  });
});
