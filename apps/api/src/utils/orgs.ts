export const NGS_ORG_ID = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05';
export const LEGACY_NGS_ORG_ID = '00000000-0000-4000-8000-000000000101';
export const NGS_ORG_SLUG = 'national-gallery-singapore';
export const NGS_ORG_KEY = 'ngs';
export const OPEN_ACCESS_ORG_SLUG = 'open-access-art';
export const OPEN_ACCESS_ORG_KEY = 'open';
export const OPEN_ACCESS_ART_ORG_KEY = 'nga';
export const OPEN_ACCESS_ART_ORG_SLUG = OPEN_ACCESS_ORG_SLUG;
export const LEGACY_OPEN_ACCESS_ART_ORG_KEY = OPEN_ACCESS_ORG_KEY;
export const OPEN_ACCESS_NGA_KEY = OPEN_ACCESS_ART_ORG_KEY;
// The NGA imports are attached to this durable organisation row. Keep the
// provider scope tied to every accepted identifier for that row so aliases
// cannot bypass the NGA-only search filter or lifetime quota.
export const OPEN_ACCESS_ORG_ID = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac';

export type OpenAccessProviderScope = 'nga';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isNgsPublicOrg = (value: string | null | undefined) => {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  return (
    key === NGS_ORG_ID ||
    key === LEGACY_NGS_ORG_ID ||
    key === NGS_ORG_SLUG ||
    key === NGS_ORG_KEY
  );
};

const isOpenAccessNgaAlias = (value: string | null | undefined) => {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  return (
    key === OPEN_ACCESS_ART_ORG_KEY ||
    key === LEGACY_OPEN_ACCESS_ART_ORG_KEY ||
    key === OPEN_ACCESS_ORG_SLUG
  );
};

// Public NGA classification is deliberately tied to the immutable organisation
// ID. Slugs are mutable user-facing identifiers, so they may be accepted as
// input aliases but must never grant public access on their own.
export const isOpenAccessPublicOrg = (value: string | null | undefined) =>
  String(value || '').trim().toLowerCase() === OPEN_ACCESS_ORG_ID;

export const resolveOpenAccessProviderScope = (
  value: string | null | undefined
): OpenAccessProviderScope | undefined => {
  const raw = String(value || '').trim();
  if (!raw) return undefined;

  let key = raw.toLowerCase();
  try {
    key = decodeURIComponent(raw).toLowerCase();
  } catch {
    // Keep the raw route value; resolveOrgIdentifier will handle invalid input.
  }

  return isOpenAccessNgaAlias(key) || isOpenAccessPublicOrg(key)
    ? 'nga'
    : undefined;
};

export const isAllowedPublicSearchRouteScope = (
  value: string | null | undefined
) => {
  const raw = String(value || '').trim();
  if (!raw) return false;

  try {
    const key = decodeURIComponent(raw).toLowerCase();
    return key === OPEN_ACCESS_NGA_KEY;
  } catch {
    return false;
  }
};

export const isOpenAccessArtPublicOrg = isOpenAccessPublicOrg;

export async function resolveOrgIdentifier(
  db: D1Database,
  value: string | null | undefined
) {
  const raw = String(value || '').trim();
  if (!raw) return undefined;

  const decoded = decodeURIComponent(raw);
  const key = decoded.toLowerCase();

  if (isNgsPublicOrg(key)) {
    try {
      const org = await db
        .prepare(
          'SELECT id FROM orgs WHERE id IN (?, ?) ORDER BY id = ? DESC LIMIT 1'
        )
        .bind(NGS_ORG_ID, LEGACY_NGS_ORG_ID, NGS_ORG_ID)
        .first<{ id: string }>();

      return org?.id || NGS_ORG_ID;
    } catch {
      return NGS_ORG_ID;
    }
  }

  if (isOpenAccessNgaAlias(key)) {
    return OPEN_ACCESS_ORG_ID;
  }

  if (UUID_RE.test(decoded)) {
    return decoded;
  }

  try {
    const org = await db
      .prepare('SELECT id FROM orgs WHERE lower(slug) = lower(?) LIMIT 1')
      .bind(decoded)
      .first<{ id: string }>();

    return org?.id || decoded;
  } catch {
    return decoded;
  }
}
