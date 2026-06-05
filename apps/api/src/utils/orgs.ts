export const NGS_ORG_ID = 'cf98791d-f3cc-4f9f-b40c-a350efadbd05';
export const LEGACY_NGS_ORG_ID = '00000000-0000-4000-8000-000000000101';
export const NGS_ORG_SLUG = 'national-gallery-singapore';
export const NGS_ORG_KEY = 'ngs';
export const OPEN_ACCESS_ORG_SLUG = 'open-access-art';
export const OPEN_ACCESS_ORG_KEY = 'open';

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

export const isOpenAccessPublicOrg = (value: string | null | undefined) => {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  return key === OPEN_ACCESS_ORG_KEY || key === OPEN_ACCESS_ORG_SLUG;
};

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

  if (isOpenAccessPublicOrg(key)) {
    try {
      const org = await db
        .prepare('SELECT id FROM orgs WHERE lower(slug) = lower(?) LIMIT 1')
        .bind(OPEN_ACCESS_ORG_SLUG)
        .first<{ id: string }>();

      return org?.id || OPEN_ACCESS_ORG_SLUG;
    } catch {
      return OPEN_ACCESS_ORG_SLUG;
    }
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
