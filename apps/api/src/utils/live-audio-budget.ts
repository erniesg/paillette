/**
 * The meter for live audio, and the only place it is enforced.
 *
 * The existing anonymous ceilings count model calls. A realtime session is
 * billed for every second its connection is open — audio tokens in and out,
 * plus the conversation replayed as context on each response — so a counter of
 * requests reads zero while the expensive thing runs. This is the second
 * meter, in seconds.
 *
 * Three properties matter more than precision:
 *
 *  - **Debited up front.** A grant is taken from both budgets when the session
 *    token is minted, not when the session ends. A client that connects and
 *    then goes silent has already paid; settlement can only ever refund. This
 *    is what makes the ceiling hold against a page that closes without saying
 *    so, which is the common case rather than the adversarial one.
 *  - **Atomic.** The guarded UPSERT admits or refuses in one statement, so two
 *    tabs racing for the last ten seconds cannot both win. KV's
 *    read-modify-write is fine for counting requests and not fine for money.
 *  - **Two independent ceilings.** Per-caller stops one visitor; site-wide
 *    stops a handful of visitors between them. Neither implies the other, and
 *    a per-caller limit alone is not a spend limit — it is a spend limit
 *    multiplied by however many people show up.
 */

export type LiveAudioBudgetEnv = {
  DB?: D1Database;
  /** Per-caller ceiling, seconds of session per rolling clock hour. */
  LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR?: string;
  /** Site-wide ceiling, seconds of session per UTC day, across all callers. */
  LIVE_AUDIO_SECONDS_PER_DAY?: string;
  /** The largest single grant. A session longer than this must re-mint. */
  LIVE_SESSION_MAX_SECONDS?: string;
};

/**
 * Three minutes per visitor per hour.
 *
 * At the rates verified against OpenAI's pricing page on 2026-09-04 —
 * gpt-realtime-2.1 at $32/1M audio input tokens and $64/1M audio output — a
 * minute of wall-clock costs at most about $0.12 with the whole minute spent
 * talking, and far less under push-to-talk, where the microphone is open only
 * while a button is held. Three minutes is therefore something under $0.40 for
 * the noisiest possible visitor, and comfortably several real exchanges for a
 * normal one.
 *
 * Deliberately small. This is a public page with no account behind it, and the
 * cost of being wrong upward is an invoice while the cost of being wrong
 * downward is a visitor who has to press the button again.
 */
export const DEFAULT_LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR = 180;

/**
 * An hour of audio a day across everybody: roughly $7 at the worst-case rate
 * above, and about twenty visitors having a full three-minute conversation.
 *
 * The per-caller limit does not bound this at all — twenty callers at three
 * minutes each is an hour whatever the per-caller number says — which is
 * exactly why both exist.
 */
export const DEFAULT_LIVE_AUDIO_SECONDS_PER_DAY = 3600;

/**
 * One grant is 90 seconds, not the whole per-caller budget.
 *
 * Grants are debited whole and refunded only on a clean close, so a large
 * grant is a large amount to lose to a browser that crashes. Small grants that
 * re-mint keep the loss small; the page re-mints transparently while the human
 * is still talking.
 */
export const DEFAULT_LIVE_SESSION_MAX_SECONDS = 90;

const positiveInt = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

export const callerSecondsPerHour = (env: LiveAudioBudgetEnv): number =>
  positiveInt(
    env.LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR,
    DEFAULT_LIVE_AUDIO_SECONDS_PER_CALLER_PER_HOUR
  );

export const siteSecondsPerDay = (env: LiveAudioBudgetEnv): number =>
  positiveInt(env.LIVE_AUDIO_SECONDS_PER_DAY, DEFAULT_LIVE_AUDIO_SECONDS_PER_DAY);

export const sessionMaxSeconds = (env: LiveAudioBudgetEnv): number =>
  positiveInt(env.LIVE_SESSION_MAX_SECONDS, DEFAULT_LIVE_SESSION_MAX_SECONDS);

/** `caller:<hash>:<hours since epoch>` — the window is in the key. */
export const callerScope = (clientHash: string, now: Date = new Date()): string =>
  `caller:${clientHash}:${Math.floor(now.getTime() / 3_600_000)}`;

/** `site:<YYYY-MM-DD>`, UTC, matching how the OpenAI day-counter is keyed. */
export const siteScope = (now: Date = new Date()): string =>
  `site:${now.toISOString().slice(0, 10)}`;

type SpendRow = { seconds_spent: number };

const readSpent = async (db: D1Database, scope: string): Promise<number> => {
  const row = await db
    .prepare(`SELECT seconds_spent FROM live_audio_budget WHERE scope = ?`)
    .bind(scope)
    .first<SpendRow>();
  return row?.seconds_spent ?? 0;
};

/**
 * Add `seconds` to a scope, but only if the result stays within `limit`.
 * Returns false without writing when it would not.
 *
 * The `WHERE` clause hangs off `DO UPDATE`, so it guards the contended path —
 * a row that already exists. The bare `INSERT` path only runs when no row
 * exists, where the spend is zero and callers have already clamped `seconds`
 * to at most `limit`.
 */
const reserve = async (
  db: D1Database,
  scope: string,
  seconds: number,
  limit: number
): Promise<boolean> => {
  const row = await db
    .prepare(
      `
      INSERT INTO live_audio_budget (scope, seconds_spent, updated_at)
      VALUES (?1, ?2, datetime('now'))
      ON CONFLICT(scope) DO UPDATE
        SET seconds_spent = live_audio_budget.seconds_spent + ?2,
            updated_at = datetime('now')
        WHERE live_audio_budget.seconds_spent + ?2 <= ?3
      RETURNING seconds_spent
      `
    )
    .bind(scope, seconds, limit)
    .first<SpendRow>();
  return row !== null;
};

/** Give seconds back. Clamped at zero so a double settlement cannot mint credit. */
const refund = async (
  db: D1Database,
  scope: string,
  seconds: number
): Promise<void> => {
  if (seconds <= 0) return;
  await db
    .prepare(
      `
      UPDATE live_audio_budget
      SET seconds_spent = MAX(0, seconds_spent - ?2),
          updated_at = datetime('now')
      WHERE scope = ?1
      `
    )
    .bind(scope, seconds)
    .run();
};

export type BudgetRefusal = {
  admitted: false;
  /** Which ceiling refused, so the page can say the true thing in one line. */
  reason: 'caller' | 'site' | 'unavailable';
};

export type BudgetGrant = {
  admitted: true;
  seconds: number;
  callerScope: string;
  siteScope: string;
};

/**
 * Take a grant from both budgets, or refuse.
 *
 * The site-wide reservation is taken first and released again if the
 * per-caller one refuses. Doing it the other way round leaks the shared
 * budget to a caller who was never admitted, which is the failure that
 * matters: a per-caller row is one visitor for one hour, while the site row
 * is everybody for the rest of the day.
 */
export const reserveLiveAudio = async (
  env: LiveAudioBudgetEnv,
  clientHash: string,
  now: Date = new Date()
): Promise<BudgetGrant | BudgetRefusal> => {
  const db = env.DB;
  // No database is no meter, and an unmetered live session is the thing this
  // module exists to prevent. Fail closed — unlike the model-call limiter,
  // which fails open because the worst case there is one extra chat request.
  if (!db) return { admitted: false, reason: 'unavailable' };

  const callerLimit = callerSecondsPerHour(env);
  const siteLimit = siteSecondsPerDay(env);
  const caller = callerScope(clientHash, now);
  const site = siteScope(now);

  try {
    const callerSpent = await readSpent(db, caller);
    const siteSpent = await readSpent(db, site);
    const seconds = Math.min(
      sessionMaxSeconds(env),
      callerLimit - callerSpent,
      siteLimit - siteSpent
    );
    if (seconds <= 0) {
      return {
        admitted: false,
        reason: siteLimit - siteSpent <= 0 ? 'site' : 'caller',
      };
    }

    if (!(await reserve(db, site, seconds, siteLimit))) {
      return { admitted: false, reason: 'site' };
    }
    if (!(await reserve(db, caller, seconds, callerLimit))) {
      await refund(db, site, seconds);
      return { admitted: false, reason: 'caller' };
    }

    return { admitted: true, seconds, callerScope: caller, siteScope: site };
  } catch {
    return { admitted: false, reason: 'unavailable' };
  }
};

/**
 * Return the part of a grant that was never used.
 *
 * Refunds go back to the scopes recorded on the session row rather than to
 * whatever the current hour is: a session minted at 10:59 and closed at 11:01
 * must credit the ten o'clock row it was debited from, or the visitor pays
 * twice and the eleven o'clock row goes negative.
 */
export const settleLiveAudio = async (
  env: LiveAudioBudgetEnv,
  session: { callerScope: string; siteScope: string; grantedSeconds: number },
  usedSeconds: number
): Promise<number> => {
  const db = env.DB;
  if (!db) return 0;
  const used = Math.max(0, Math.min(session.grantedSeconds, Math.ceil(usedSeconds)));
  const unused = session.grantedSeconds - used;
  if (unused > 0) {
    await refund(db, session.siteScope, unused);
    await refund(db, session.callerScope, unused);
  }
  return used;
};

/** What the two meters currently read, for the report and for the page's degrade path. */
export const readLiveAudioBudget = async (
  env: LiveAudioBudgetEnv,
  clientHash: string,
  now: Date = new Date()
): Promise<{
  callerRemaining: number;
  siteRemaining: number;
  callerLimit: number;
  siteLimit: number;
} | null> => {
  const db = env.DB;
  if (!db) return null;
  try {
    const callerLimit = callerSecondsPerHour(env);
    const siteLimit = siteSecondsPerDay(env);
    return {
      callerLimit,
      siteLimit,
      callerRemaining: Math.max(
        0,
        callerLimit - (await readSpent(db, callerScope(clientHash, now)))
      ),
      siteRemaining: Math.max(0, siteLimit - (await readSpent(db, siteScope(now)))),
    };
  } catch {
    return null;
  }
};
