import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PUBLIC_COLLECTIONS } from '../collections';

/**
 * `searchPath` is not decoration: `set_results` navigates the human's browser
 * to it live, and `search_artworks` hands it back as `humanSearchUrl`. It
 * pointed at `/collections/nga/search` — a route that only matches
 * `collections.$collectionId.search`, which resolves a collection UUID and
 * 404s for `nga` — so an agent driving the page sent the human to an error
 * page. The public collection search page is `$orgId.search`, i.e. `/nga/search`.
 *
 * This checks each descriptor's path against the route files on disk rather
 * than against a hardcoded string, so a future collection cannot reintroduce
 * the same mismatch.
 */
describe('public collection descriptors', () => {
  const routeFiles = readdirSync(resolve(__dirname, '../../../routes'));

  it('every searchPath resolves to a real public search route', () => {
    for (const collection of PUBLIC_COLLECTIONS) {
      const segments = collection.searchPath.split('/').filter(Boolean);

      // `/<orgId>/search` is the anonymous page; anything under `/collections`
      // is the authenticated, UUID-scoped route and cannot serve a public id.
      expect(segments).toHaveLength(2);
      expect(segments[0]).toBe(collection.id);
      expect(segments[1]).toBe('search');
      expect(routeFiles).toContain('$orgId.search.tsx');
    }
  });
});
