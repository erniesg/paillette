import type { PublicSearchQuota } from '@paillette/types';

export const NGA_PUBLIC_SEARCH_QUOTA_SCOPE = 'nga-public-search';
export const NGA_PUBLIC_SEARCH_QUOTA_LIMIT = 1000;

type QuotaRow = {
  used: number;
  hard_limit: number;
};

const toPublicSearchQuota = (row: QuotaRow): PublicSearchQuota => ({
  limit: row.hard_limit,
  used: row.used,
  remaining: Math.max(row.hard_limit - row.used, 0),
});

const getQuotaRow = async (db: D1Database): Promise<QuotaRow> => {
  const row = await db
    .prepare(
      `
      SELECT used, hard_limit
      FROM nga_public_search_quota
      WHERE scope = ?
      `
    )
    .bind(NGA_PUBLIC_SEARCH_QUOTA_SCOPE)
    .first<QuotaRow>();

  if (!row) {
    throw new Error('NGA public search quota row is missing');
  }

  return row;
};

export const getNgaPublicSearchQuota = async (
  db: D1Database
): Promise<PublicSearchQuota> => toPublicSearchQuota(await getQuotaRow(db));

export const reserveNgaPublicSearchQuota = async (
  db: D1Database
): Promise<{ admitted: boolean; quota: PublicSearchQuota }> => {
  const reserved = await db
    .prepare(
      `
      UPDATE nga_public_search_quota
      SET used = used + 1,
          updated_at = datetime('now')
      WHERE scope = ?
        AND used < hard_limit
      RETURNING used, hard_limit
      `
    )
    .bind(NGA_PUBLIC_SEARCH_QUOTA_SCOPE)
    .first<QuotaRow>();

  if (reserved) {
    return { admitted: true, quota: toPublicSearchQuota(reserved) };
  }

  return { admitted: false, quota: toPublicSearchQuota(await getQuotaRow(db)) };
};
