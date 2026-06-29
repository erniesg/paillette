import { describe, expect, it } from 'vitest';

import { getPreferredOrgRouteId, resolveOrgIdentifier } from '../api';

describe('open access org aliases', () => {
  it('resolves the open short key to the Open Access Art slug', () => {
    expect(resolveOrgIdentifier('open')).toBe('open-access-art');
    expect(resolveOrgIdentifier('OPEN')).toBe('open-access-art');
  });

  it('prefers deployed Open Access Art UI routes over the API alias', () => {
    expect(getPreferredOrgRouteId('open', 'open-access-art')).toBe(
      'open-access-art'
    );
    expect(getPreferredOrgRouteId('open-access-art', 'open-access-art')).toBe(
      'open-access-art'
    );
  });
});
