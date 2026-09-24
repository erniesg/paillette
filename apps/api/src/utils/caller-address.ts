/**
 * Whose address an anonymous paid call is counted against.
 *
 * The label and agent budgets are per caller, keyed on the caller's address.
 * Called directly, that is Cloudflare's CF-Connecting-IP. Called through the
 * web app's proxies — which is how every visitor to the page calls them — it
 * is not: measured on staging, Cloudflare rewrites CF-Connecting-IP on the
 * proxy's subrequest to the web worker's own address, so every visitor shared
 * one "per-caller" budget.
 *
 * So the proxy relays the visitor's address as `X-Paillette-Visitor-Ip`, and
 * it is believed only when the request also carries the web app's server-side
 * public-search key. A direct caller can send the header but not the key, and
 * without the key the header is ignored and the connecting address stands.
 */

type HeaderReader = {
  req: { header: (name: string) => string | undefined };
  env: { PAILLETTE_PUBLIC_SEARCH_API_KEY?: string };
};

const looksLikeAddress = (value: string) =>
  value.length <= 45 &&
  (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) || /^[0-9a-fA-F:]+$/.test(value));

export const callerAddress = (c: HeaderReader): string | undefined => {
  const key = c.env.PAILLETTE_PUBLIC_SEARCH_API_KEY?.trim();
  const presented = c.req.header('X-API-Key')?.trim();
  const relayed = c.req.header('X-Paillette-Visitor-Ip')?.trim();
  if (key && presented === key && relayed && looksLikeAddress(relayed)) {
    return relayed;
  }
  return c.req.header('CF-Connecting-IP')?.trim() || undefined;
};
