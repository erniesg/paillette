const API_ASSET_CONTENT_PATH = /^\/api\/v1\/assets\/([^/]+)\/content\/?$/;
const SAFE_ASSET_ID = /^[A-Za-z0-9_-]{1,160}$/;

export const isSafePublicAssetId = (assetId: string) =>
  SAFE_ASSET_ID.test(assetId);

/** Convert an API asset URL to the session-authenticated same-origin proxy. */
export const getAuthenticatedAssetUrl = (
  value: string | null | undefined
): string | null => {
  if (!value) return null;

  let parsed: URL;
  try {
    parsed = new URL(value, 'https://paillette.local');
  } catch {
    return value;
  }

  const match = parsed.pathname.match(API_ASSET_CONTENT_PATH);
  if (!match) return value;

  let assetId: string;
  try {
    assetId = decodeURIComponent(match[1]!);
  } catch {
    return null;
  }

  return isSafePublicAssetId(assetId)
    ? `/api/public-assets/${encodeURIComponent(assetId)}/content`
    : null;
};
