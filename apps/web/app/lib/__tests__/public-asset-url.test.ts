import { describe, expect, it } from 'vitest';
import { getAuthenticatedAssetUrl } from '../public-asset-url';

describe('getAuthenticatedAssetUrl', () => {
  it('rewrites production and staging API asset URLs to the same-origin proxy', () => {
    expect(
      getAuthenticatedAssetUrl(
        'https://paillette-api.berlayar.ai/api/v1/assets/prod-asset/content'
      )
    ).toBe('/api/public-assets/prod-asset/content');
    expect(
      getAuthenticatedAssetUrl(
        'https://paillette-api-stg.berlayar.ai/api/v1/assets/stg-asset/content'
      )
    ).toBe('/api/public-assets/stg-asset/content');
  });

  it('leaves external, data, and already-proxied image URLs unchanged', () => {
    expect(getAuthenticatedAssetUrl('https://images.example/art.jpg')).toBe(
      'https://images.example/art.jpg'
    );
    expect(getAuthenticatedAssetUrl('data:image/svg+xml,hello')).toBe(
      'data:image/svg+xml,hello'
    );
    expect(
      getAuthenticatedAssetUrl('/api/public-assets/asset-123/content')
    ).toBe('/api/public-assets/asset-123/content');
  });

  it('preserves null and rejects encoded path separators', () => {
    expect(getAuthenticatedAssetUrl(null)).toBeNull();
    expect(
      getAuthenticatedAssetUrl(
        'https://paillette-api.berlayar.ai/api/v1/assets/private%2Fsecret/content'
      )
    ).toBeNull();
  });
});
