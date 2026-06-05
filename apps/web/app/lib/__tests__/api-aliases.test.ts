import { describe, expect, it } from 'vitest';

import { getPreferredOrgRouteId, resolveOrgIdentifier } from '../api';

describe('open access org aliases', () => {
  it('resolves the open short key to the Open Access Art slug', () => {
    expect(resolveOrgIdentifier('open')).toBe('open-access-art');
    expect(resolveOrgIdentifier('OPEN')).toBe('open-access-art');
  });

  it('prefers /open routes for the Open Access Art collection', () => {
    expect(getPreferredOrgRouteId('open', 'open-access-art')).toBe('open');
    expect(getPreferredOrgRouteId('open-access-art', 'open-access-art')).toBe(
      'open'
    );
  });
});
