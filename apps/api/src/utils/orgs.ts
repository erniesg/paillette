export const NGS_ORG_ID = '00000000-0000-4000-8000-000000000101';
export const NGS_ORG_SLUG = 'national-gallery-singapore';
export const NGS_ORG_KEY = 'ngs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isNgsPublicOrg = (value: string | null | undefined) => {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  return key === NGS_ORG_ID || key === NGS_ORG_SLUG || key === NGS_ORG_KEY;
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
    return NGS_ORG_ID;
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
