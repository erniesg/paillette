/**
 * Which way this exhibition is being shown.
 *
 * The room is **one** template, not the destination. Whoever opens the link
 * picks, and the pick lives in the URL so that a shared link opens in the view
 * it was shared in — the same reason the show itself is in the URL rather than
 * in a session.
 *
 * The default is the flat page and that is a hard rule rather than a
 * preference. A short link is pasted into a chat and opened cold, on a phone
 * somebody is holding one-handed, on a machine whose GPU we know nothing
 * about. Landing that person in a WebGL scene is a bet placed with their
 * attention; landing them on a page that has always worked is not. So `?v` is
 * absent for the view everyone gets and present only when someone asked.
 *
 * Unknown values fall back to the page rather than 404ing. A truncated or
 * mangled query parameter is a chat client's doing, not a request to fail.
 */

export const TEMPLATE_PARAM = 'v';

export const EXHIBITION_TEMPLATES = ['page', 'room'] as const;
export type ExhibitionTemplate = (typeof EXHIBITION_TEMPLATES)[number];

export const DEFAULT_TEMPLATE: ExhibitionTemplate = 'page';

export const readTemplate = (value: string | null | undefined): ExhibitionTemplate =>
  value === 'room' ? 'room' : DEFAULT_TEMPLATE;

/**
 * The URL for a template, from wherever we are now.
 *
 * The default template drops the parameter entirely rather than writing
 * `?v=page`. Two URLs for one page is a canonicalisation problem and, more
 * plainly, the address of the ordinary view of a show should be the ordinary
 * address of the show.
 */
export const templateHref = (
  currentPathWithQuery: string,
  template: ExhibitionTemplate
): string => {
  const [path = '', query = ''] = currentPathWithQuery.split('?');
  const params = new URLSearchParams(query);
  if (template === DEFAULT_TEMPLATE) params.delete(TEMPLATE_PARAM);
  else params.set(TEMPLATE_PARAM, template);
  const rest = params.toString();
  return rest ? `${path}?${rest}` : path;
};

/**
 * What a crawler and a `rel=canonical` should agree on.
 *
 * One show is one document however it is being drawn, so the template never
 * appears in the canonical URL. Without this, sharing the room view of a
 * self-contained link would mint a second canonical URL for the same
 * exhibition and split it in every index that reads them.
 */
export const stripTemplate = (url: string): string => {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete(TEMPLATE_PARAM);
    return parsed.toString();
  } catch {
    return url;
  }
};
