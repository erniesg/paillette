import { describe, expect, it } from 'vitest';

import {
  getKnownPublicOrg,
  getPreferredOrgRouteBasePath,
  getPreferredOrgRouteId,
  getPublicOrgDisplay,
  getPublicOrgRouteBasePath,
  getPublicSearchRouteId,
  isLegacyOpenAccessRoute,
  isOpenAccessArtPublicOrg,
  isOpenAccessNgaAlias,
  resolveOrgIdentifier,
} from '../api';

describe('public org aliases', () => {
  it('maps Open Access Art public aliases to the backing slug', () => {
    expect(resolveOrgIdentifier('nga')).toBe('open-access-art');
    expect(resolveOrgIdentifier('NGA')).toBe('open-access-art');
    expect(resolveOrgIdentifier('open')).toBe('open-access-art');
    expect(resolveOrgIdentifier('OPEN')).toBe('open-access-art');
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

  it('prefers nga for Open Access Art public UI routes', () => {
    expect(getPreferredOrgRouteId('open', 'open-access-art')).toBe('nga');
    expect(getPreferredOrgRouteId('open-access-art', 'open-access-art')).toBe(
      'nga'
    );
    expect(getPreferredOrgRouteId('nga', 'open-access-art')).toBe('nga');
    expect(isOpenAccessArtPublicOrg('anything', 'open-access-art')).toBe(true);
  });

  it('keeps collection-style canonical routes for Open Access Art', () => {
    expect(getPreferredOrgRouteBasePath('nga', 'open-access-art')).toBe(
      '/collections/nga'
    );
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

  it('keeps the NGA public search scope separate from the shared org id', () => {
    expect(getPublicSearchRouteId('nga', 'open-access-art')).toBe('nga');
    expect(getPublicSearchRouteId('ngs', 'ngs-org-id')).toBe('ngs-org-id');
  });

  it('provides local metadata for known public routes', () => {
    expect(getKnownPublicOrg('ngs')).toMatchObject({
      id: 'cf98791d-f3cc-4f9f-b40c-a350efadbd05',
      name: 'National Gallery Singapore',
      slug: 'national-gallery-singapore',
    });
    expect(getKnownPublicOrg('nga')).toMatchObject({
      id: 'open-access-art',
      slug: 'open-access-art',
    });
    expect(getKnownPublicOrg('private-org')).toBeNull();
  });

  it('uses NGA institution identity on the dedicated public route', () => {
    const org = getPublicOrgDisplay(
      { name: 'Open Access Art', slug: 'open-access-art' },
      'nga'
    );

    expect(org.name).toBe('National Gallery of Art, Washington');
  });

  it('identifies canonical and legacy NGA aliases separately', () => {
    expect(isOpenAccessNgaAlias('nga')).toBe(true);
    expect(isOpenAccessNgaAlias('open')).toBe(true);
    expect(isOpenAccessNgaAlias('open-access-art')).toBe(true);
    expect(isLegacyOpenAccessRoute('nga')).toBe(false);
    expect(isLegacyOpenAccessRoute('open')).toBe(true);
    expect(isLegacyOpenAccessRoute('open-access-art')).toBe(true);
  });
});
