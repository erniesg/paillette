import type { PublicSearchSpotlightBundle } from '@paillette/types/public-search';
import { getSpotlightArtworks } from './search-spotlights';
import { selectIdleShowcaseArtworks } from './idle-showcase';
import { getAuthenticatedAssetUrl } from './public-asset-url';

export const getNgsSpotlightThumbnailPaths = (
  bundle: PublicSearchSpotlightBundle
) => {
  if (bundle.provider !== 'ngs') return [];
  return [
    ...new Set(
      bundle.suggestions.flatMap((suggestion) =>
        selectIdleShowcaseArtworks(getSpotlightArtworks(bundle, suggestion.id))
          .map((artwork) =>
            getAuthenticatedAssetUrl(artwork.thumbnailUrl || artwork.imageUrl)
          )
          .filter((path): path is string =>
            Boolean(
              path &&
                /^\/api\/public-assets\/[A-Za-z0-9_-]{1,160}\/content$/.test(
                  path
                )
            )
          )
      )
    ),
  ];
};

// Warm only the finite prepared highlight selection, never text searches or
// arbitrary URLs. Normal image rendering is independent of this background work.
// The protected proxy revalidates access before browser bytes can be reused.
export async function prefetchNgsSpotlightThumbnails(
  bundle: PublicSearchSpotlightBundle,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch
) {
  const paths = getNgsSpotlightThumbnailPaths(bundle);
  let next = 0;
  let denied = false;
  const worker = async () => {
    while (!signal.aborted && !denied && next < paths.length) {
      const path = paths[next++]!;
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(cancel, 10_000);
      try {
        const response = await fetcher(path, {
          credentials: 'same-origin',
          cache: 'default',
          signal: controller.signal,
          ...({ priority: 'low' } as RequestInit),
        });
        if (response.ok) await response.arrayBuffer();
        // Session/entitlement loss must stop warming, not fan out more requests.
        if (response.status === 401 || response.status === 403) {
          denied = true;
          return;
        }
      } catch {
        // A failed thumbnail cannot block other cards or the person's search.
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', cancel);
      }
    }
  };
  await Promise.all([worker(), worker()]);
}
