import { describe, expect, it } from 'vitest';
import { getDocumentCacheControl } from '../worker';

describe('web worker document cache policy', () => {
  it('prevents shared caching of Remix HTML documents', () => {
    const request = new Request('https://paillette.berlayar.ai/nga/search', {
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });

    expect(getDocumentCacheControl(request)).toBe('private, no-store');
  });

  it('leaves non-document requests, including static assets, unchanged', () => {
    const asset = new Request('https://paillette.berlayar.ai/build/app.js', {
      headers: { Accept: '*/*' },
    });

    expect(getDocumentCacheControl(asset)).toBeNull();
  });
});
