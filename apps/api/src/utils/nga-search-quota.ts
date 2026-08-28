import type { PublicSearchQuota } from '@paillette/types';
import type { PreparedApiUsageEvent } from '../middleware/auth';

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

/**
 * Reserves one NGA public-search slot and persists its accepted-search event in
 * one D1 batch transaction. The usage insert is conditional on the preceding
 * guarded quota update, so an exhausted request creates no event. If either
 * statement fails, D1 rolls the whole batch back and callers must fail closed.
 */
export const reserveNgaPublicSearchQuotaWithUsageEvent = async (
  db: D1Database,
  usageEvent: PreparedApiUsageEvent
): Promise<{ admitted: boolean; quota: PublicSearchQuota }> => {
  const quotaStatement = db
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
    .bind(NGA_PUBLIC_SEARCH_QUOTA_SCOPE);

  const [reservation] = await db.batch<QuotaRow>([
    quotaStatement,
    usageEvent.statement,
  ]);
  const reserved = reservation?.results[0];

  if (reserved) {
    usageEvent.markRecorded();
    return { admitted: true, quota: toPublicSearchQuota(reserved) };
  }

  return { admitted: false, quota: toPublicSearchQuota(await getQuotaRow(db)) };
};
