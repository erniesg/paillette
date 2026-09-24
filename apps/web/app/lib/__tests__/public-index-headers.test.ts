import { describe, expect, it } from 'vitest';
import { buildPublicIndexHeaders } from '../public-index.server';

const visit = (headers: Record<string, string>) =>
  new Request('https://paillette.test/api/public-labels', { method: 'POST', headers });

describe('buildPublicIndexHeaders — relaying the visitor', () => {
  it('relays the edge address under the server key for the per-caller routes', () => {
    const headers = buildPublicIndexHeaders(
      visit({ 'CF-Connecting-IP': '203.0.113.9' }),
      'application/json',
      { PAILLETTE_PUBLIC_SEARCH_API_KEY: 'server-key' }
    );
    expect(headers.get('X-Paillette-Visitor-Ip')).toBe('203.0.113.9');
    expect(headers.get('X-API-Key')).toBe('server-key');
  });

  it('relays nothing for routes that did not ask, or with no key configured', () => {
    for (const headers of [
      buildPublicIndexHeaders(visit({ 'CF-Connecting-IP': '203.0.113.9' })),
      buildPublicIndexHeaders(visit({ 'CF-Connecting-IP': '203.0.113.9' }), undefined, {}),
    ]) {
      expect(headers.get('X-Paillette-Visitor-Ip')).toBeNull();
      expect(headers.get('X-API-Key')).toBeNull();
    }
  });

  it('never passes on a visitor address the browser wrote itself', () => {
    const headers = buildPublicIndexHeaders(
      visit({ 'X-Paillette-Visitor-Ip': '198.51.100.66', 'X-API-Key': 'guessed' }),
      'application/json',
      { PAILLETTE_PUBLIC_SEARCH_API_KEY: 'server-key' }
    );
    expect(headers.get('X-Paillette-Visitor-Ip')).toBeNull();
    expect(headers.get('X-API-Key')).toBeNull();
  });
});
