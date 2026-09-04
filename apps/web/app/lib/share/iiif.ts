/**
 * Asking IIIF for the size you actually need.
 *
 * The institution's image server puts the size in the path, so a wall image, a
 * thumbnail and a 1200px social card are the same URL with one segment
 * changed. Worth doing rather than serving the master file: an NGA original is
 * several megabytes, and a crawler that times out fetching an `og:image` shows
 * the link with no picture at all — which is most of what makes a shared link
 * look broken.
 *
 * Shared between the page and the crawler preview, and deliberately not in a
 * `.server` module: both ends need it, and it is pure string work.
 */

/** `/full/{size}/0/` — the IIIF Image API's size segment. */
const IIIF_FULL_SIZE = /\/full\/[^/]+\/0\//;

/**
 * Non-IIIF URLs pass through untouched. Plenty of records resolve to a plain
 * asset URL, and half-rewriting one produces a 404 where the original worked.
 */
export const atWidth = (url: string | null, width: number): string | null =>
  url && IIIF_FULL_SIZE.test(url)
    ? url.replace(IIIF_FULL_SIZE, `/full/${width},/0/`)
    : url;

/**
 * The width a social card wants.
 *
 * `summary_large_image` renders at 1200×628 across Slack, X and WhatsApp, and
 * every one of them has a fetch budget measured in low seconds. 1200 is the
 * card's own width, so anything larger is bytes spent to be downscaled.
 */
export const SOCIAL_CARD_WIDTH = 1200;

/** What the page hangs on a wall. Generous, because it is looked at. */
export const WALL_IMAGE_WIDTH = 1400;
