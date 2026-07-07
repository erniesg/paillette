import { describe, expect, it } from 'vitest';
import {
  getPreferredOrgRouteId,
  getPublicOrgRouteBasePath,
  isOpenAccessArtPublicOrg,
  resolveOrgIdentifier,
} from '../api';

describe('public org aliases', () => {
  it('maps NGA public aliases to the Open Access Art backing slug', () => {
    expect(resolveOrgIdentifier('nga')).toBe('open-access-art');
    expect(resolveOrgIdentifier('open')).toBe('open-access-art');
    expect(resolveOrgIdentifier('open-access-art')).toBe('open-access-art');
  });

  it('keeps NGS as National Gallery Singapore', () => {
    expect(resolveOrgIdentifier('ngs')).toBe(
      'cf98791d-f3cc-4f9f-b40c-a350efadbd05'
    );
    expect(getPreferredOrgRouteId('ngs', 'national-gallery-singapore')).toBe(
      'ngs'
    );
  });

  it('prefers nga for Open Access Art UI routes', () => {
    expect(getPreferredOrgRouteId('open', 'open-access-art')).toBe('nga');
    expect(getPreferredOrgRouteId('open-access-art', 'open-access-art')).toBe(
      'nga'
    );
    expect(getPreferredOrgRouteId('nga', 'open-access-art')).toBe('nga');
    expect(isOpenAccessArtPublicOrg('anything', 'open-access-art')).toBe(true);
  });

  it('uses collection-style public routes for Open Access Art and collection routes', () => {
    expect(
      getPublicOrgRouteBasePath({
        requestedOrgId: 'open-access-art',
        preferredRouteId: 'nga',
        canonicalSlug: 'open-access-art',
        routeScope: 'org',
      })
    ).toBe('/collections/nga');

    expect(
      getPublicOrgRouteBasePath({
        requestedOrgId: 'ngs',
        preferredRouteId: 'ngs',
        canonicalSlug: 'national-gallery-singapore',
        routeScope: 'org',
      })
    ).toBe('/ngs');

    expect(
      getPublicOrgRouteBasePath({
        requestedOrgId: 'ngs',
        preferredRouteId: 'ngs',
        canonicalSlug: 'national-gallery-singapore',
        routeScope: 'collection',
      })
    ).toBe('/collections/ngs');
  });
});
