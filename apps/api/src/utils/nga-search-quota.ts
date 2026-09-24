/**
 * The NGA public-search quota: per caller, over any 24 hours.
 *
 * It used to be one lifetime counter for the whole deployment
 * (`nga_public_search_quota`, migration 0018). That reached 1000/1000 mid-run on
 * staging and had to be reset by hand, one visitor could spend it for
 * everybody, and it never came back on its own. It also counted searches
 * answered from the result cache, which cost the provider nothing.
 *
 * Now each admitted search is one row in `nga_public_search_debits` (0023),
 * keyed by a hash of the same caller identity the per-minute limit uses. A
 * search is admitted while the caller has fewer than `limit` rows in the last
 * 24 hours **and** the site has fewer than `siteLimit`. The second clause is
 * the spend guard: a per-caller limit alone is unbounded in the number of
 * callers.
 *
 * The shape the page reads is unchanged — `{limit, used, remaining}` — and now
 * means "yours, today". `remaining` is the smaller of what the caller and the
 * site have left, so it never promises a search the site would refuse.
 */

import type { PublicSearchQuota } from '@paillette/types';
import type { PreparedApiUsageEvent } from '../middleware/auth';
import { DAY_MS, limitFromEnv } from './rolling-window';

/**
 * Per caller, per 24 hours, where the environment sets nothing.
 *
 * Production sets nothing, so these are its numbers: the same thousand the
 * lifetime counter allowed, now per day for the whole site, with no one caller
 * able to take more than a tenth of it. Raising either is a spend decision and
 * is left to the owner; staging raises both in wrangler.toml.
 */
export const DEFAULT_NGA_SEARCHES_PER_DAY = 100;
/** The whole site, per 24 hours, where the environment sets nothing. */
export const DEFAULT_NGA_SITE_SEARCHES_PER_DAY = 1000;
export const NGA_SEARCH_WINDOW_MS = DAY_MS;

export type NgaSearchQuotaScope = {
  /** From `getPublicSearchRequestClientIdentity`; hashed before storage. */
  clientIdentity: string | undefined;
  limit: number;
  siteLimit: number;
  now?: number;
};

export const ngaSearchQuotaScope = (
  env: { NGA_SEARCH_CALLS_PER_DAY?: string; NGA_SEARCH_SITE_CALLS_PER_DAY?: string },
  clientIdentity: string | undefined
): NgaSearchQuotaScope => ({
  clientIdentity,
  limit: limitFromEnv(env.NGA_SEARCH_CALLS_PER_DAY, DEFAULT_NGA_SEARCHES_PER_DAY),
  siteLimit: limitFromEnv(
    env.NGA_SEARCH_SITE_CALLS_PER_DAY,
    DEFAULT_NGA_SITE_SEARCHES_PER_DAY
  ),
});

const toHex = (value: ArrayBuffer): string =>
  Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');

/**
 * Callers without an identity share one bucket rather than getting a free
 * pass. The per-minute limit already refuses most of them.
 */
const clientHashFor = async (identity: string | undefined) =>
  toHex(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`nga-search-quota:${identity ?? 'anonymous'}`)
    )
  );

type CountRow = { used: number; site_used: number };

const toPublicSearchQuota = (
  row: CountRow,
  scope: NgaSearchQuotaScope
): PublicSearchQuota => ({
  limit: scope.limit,
  used: Math.min(row.used, scope.limit),
  remaining: Math.max(
    Math.min(scope.limit - row.used, scope.siteLimit - row.site_used),
    0
  ),
});

const COUNT_SQL = `
  SELECT
    (SELECT COUNT(*) FROM nga_public_search_debits
      WHERE client_hash = ? AND debited_at > ?) AS used,
    (SELECT COUNT(*) FROM nga_public_search_debits
      WHERE debited_at > ?) AS site_used
`;

const window = (scope: NgaSearchQuotaScope) => {
  const now = scope.now ?? Date.now();
  return { now, since: now - NGA_SEARCH_WINDOW_MS };
};

export const getNgaPublicSearchQuota = async (
  db: D1Database,
  scope: NgaSearchQuotaScope
): Promise<PublicSearchQuota> => {
  const clientHash = await clientHashFor(scope.clientIdentity);
  const { since } = window(scope);
  const row = await db
    .prepare(COUNT_SQL)
    .bind(clientHash, since, since)
    .first<CountRow>();
  return toPublicSearchQuota(row ?? { used: 0, site_used: 0 }, scope);
};

export type NgaSearchReservation = {
  admitted: boolean;
  quota: PublicSearchQuota;
  /** The row to delete if the search turns out not to have cost anything. */
  debitId: number | null;
};

/**
 * The statements every reservation runs, in order: forget what has left the
 * window, debit one if the caller and the site both have room, and count.
 * The usage event, when there is one, goes between the debit and the count so
 * its `WHERE changes() = 1` reads the debit.
 */
const reservationStatements = async (
  db: D1Database,
  scope: NgaSearchQuotaScope
) => {
  const clientHash = await clientHashFor(scope.clientIdentity);
  const { now, since } = window(scope);
  return {
    prune: db
      .prepare('DELETE FROM nga_public_search_debits WHERE debited_at <= ?')
      .bind(since),
    debit: db
      .prepare(
        `
        INSERT INTO nga_public_search_debits (client_hash, debited_at)
        SELECT ?, ?
        WHERE (SELECT COUNT(*) FROM nga_public_search_debits
                WHERE client_hash = ? AND debited_at > ?) < ?
          AND (SELECT COUNT(*) FROM nga_public_search_debits
                WHERE debited_at > ?) < ?
        RETURNING id
        `
      )
      .bind(clientHash, now, clientHash, since, scope.limit, since, scope.siteLimit),
    count: db.prepare(COUNT_SQL).bind(clientHash, since, since),
  };
};

type BatchResult = { results?: unknown[] } | undefined;

const readReservation = (
  debit: BatchResult,
  count: BatchResult,
  scope: NgaSearchQuotaScope
): NgaSearchReservation => {
  const debited = (debit?.results?.[0] ?? null) as { id?: number } | null;
  const counted = (count?.results?.[0] ?? { used: 0, site_used: 0 }) as CountRow;
  return {
    admitted: Boolean(debited),
    quota: toPublicSearchQuota(counted, scope),
    debitId: typeof debited?.id === 'number' ? debited.id : null,
  };
};

export const reserveNgaPublicSearchQuota = async (
  db: D1Database,
  scope: NgaSearchQuotaScope
): Promise<NgaSearchReservation> => {
  const { prune, debit, count } = await reservationStatements(db, scope);
  const [, debitResult, countResult] = await db.batch([prune, debit, count]);
  return readReservation(debitResult, countResult, scope);
};

/**
 * Reserves one search and persists its accepted-search event in one D1 batch.
 * The usage insert is conditional on the debit (`WHERE changes() = 1`), so a
 * refused search creates no event. If any statement fails, D1 rolls the whole
 * batch back and callers must fail closed.
 */
export const reserveNgaPublicSearchQuotaWithUsageEvent = async (
  db: D1Database,
  usageEvent: PreparedApiUsageEvent,
  scope: NgaSearchQuotaScope
): Promise<NgaSearchReservation> => {
  const { prune, debit, count } = await reservationStatements(db, scope);
  const [, debitResult, , countResult] = await db.batch([
    prune,
    debit,
    usageEvent.statement,
    count,
  ]);
  const reservation = readReservation(debitResult, countResult, scope);
  if (reservation.admitted) usageEvent.markRecorded();
  return reservation;
};
