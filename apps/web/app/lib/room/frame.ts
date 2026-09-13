/**
 * The finish around a work belongs to the exhibition address.
 *
 * A frame is a visitor's reversible presentation choice, like the room
 * template. The absent parameter is intentionally the restrained default so
 * that one unframed show has one ordinary URL.
 */
export const FRAME_PARAM = 'frame';

export const FRAME_STYLES = ['none', 'black', 'white', 'oak', 'gilt'] as const;
export type FrameStyle = (typeof FRAME_STYLES)[number];

export const DEFAULT_FRAME: FrameStyle = 'none';

export const readFrame = (value: string | null | undefined): FrameStyle =>
  FRAME_STYLES.includes(value as FrameStyle) ? (value as FrameStyle) : DEFAULT_FRAME;

/**
 * Change only the presentation choice in a relative exhibition address.
 *
 * Hashes are kept because an exhibition link may open on its works list; the
 * native URL API needs a base for relative URLs, so this deliberately parses
 * the small path/query/hash shape directly.
 */
export const frameHref = (
  currentPathWithQuery: string,
  frame: FrameStyle
): string => {
  const hashAt = currentPathWithQuery.indexOf('#');
  const beforeHash =
    hashAt === -1 ? currentPathWithQuery : currentPathWithQuery.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : currentPathWithQuery.slice(hashAt);
  const queryAt = beforeHash.indexOf('?');
  const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? '' : beforeHash.slice(queryAt + 1));

  if (frame === DEFAULT_FRAME) params.delete(FRAME_PARAM);
  else params.set(FRAME_PARAM, frame);

  const query = params.toString();
  return `${path}${query ? `?${query}` : ''}${hash}`;
};
