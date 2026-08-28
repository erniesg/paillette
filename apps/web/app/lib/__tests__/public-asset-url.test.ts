import { describe, expect, it } from 'vitest';
import {
  getAuthenticatedAssetUrl,
  isSafePublicAssetId,
} from '../public-asset-url';

describe('protected asset URLs', () => {
  it('rewrites only API asset-content URLs to the same-origin session proxy', () => {
    expect(
      getAuthenticatedAssetUrl(
        'https://paillette-api.berlayar.ai/api/v1/assets/asset_123/content'
      )
    ).toBe('/api/public-assets/asset_123/content');
    expect(getAuthenticatedAssetUrl('https://images.example.test/a.jpg')).toBe(
      'https://images.example.test/a.jpg'
    );
  });

  it('rejects unsafe asset IDs', () => {
    expect(isSafePublicAssetId('../private')).toBe(false);
    expect(
      getAuthenticatedAssetUrl('/api/v1/assets/%2E%2E%2Fprivate/content')
    ).toBeNull();
  });
});
