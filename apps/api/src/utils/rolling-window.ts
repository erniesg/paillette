/**
 * A per-caller budget that refills continuously, not on the hour.
 *
 * The label and agent caps used to count into a bucket named for the clock
 * hour (`Math.floor(Date.now() / 3_600_000)`). Two things were wrong with that
 * shape, and neither was the number:
 *
 *  - **The boundary resets everything.** Ten calls at 12:59 and ten more at
 *    13:01 is twenty in two minutes, and a person who spends the budget at
 *    13:01 waits fifty-nine minutes for any of it back. A show being curated
 *    does not know what time it is.
 *  - **Nobody can say how much is left.** A fixed bucket can report a count,
 *    but not when the next call becomes available, which is the one thing a
 *    page with a spent budget needs to tell a human.
 *
 * So each caller's key holds the timestamps of their calls inside the window,
 * newest last and never more than `limit` of them. A call is admitted when
 * fewer than `limit` fall inside the last `windowMs`, and the oldest one
 * leaving the window is when the next call opens up.
 *
 * KV is eventually consistent and this is a read-then-write, so two calls in
 * the same instant can both be admitted. That was equally true of the counter
 * it replaces, and it is the right trade for a cap that must bound a person,
 * not hold to the unit. Fails open when KV is unavailable, as before.
 */

export type RollingWindowOptions = {
  limit: number;
  windowMs: number;
  now?: number;
};

export type RollingWindowState = {
  limit: number;
  used: number;
  remaining: number;
  /**
   * When the next call becomes available: the moment the oldest counted call
   * leaves the window. Null while there is room now.
   */
  nextAt: number | null;
};

const readStamps = async (
  kv: KVNamespace,
  key: string,
  windowMs: number,
  now: number
): Promise<number[]> => {
  const raw = await kv.get(key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((stamp): stamp is number => typeof stamp === 'number' && Number.isFinite(stamp))
      .filter((stamp) => stamp > now - windowMs && stamp <= now)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
};

const toState = (
  stamps: number[],
  { limit, windowMs }: RollingWindowOptions
): RollingWindowState => {
  const used = Math.min(stamps.length, limit);
  const remaining = Math.max(limit - stamps.length, 0);
  // The call that has to leave for one more to fit is the one `limit` places
  // from the end — with a lowered limit that can be more than the oldest.
  const blocking = stamps[stamps.length - limit];
  return {
    limit,
    used,
    remaining,
    nextAt: remaining > 0 || blocking === undefined ? null : blocking + windowMs,
  };
};

/** How the window stands, without spending anything. */
export const readRollingWindow = async (
  kv: KVNamespace | undefined,
  key: string,
  options: RollingWindowOptions
): Promise<RollingWindowState | null> => {
  if (!kv) return null;
  const now = options.now ?? Date.now();
  try {
    return toState(await readStamps(kv, key, options.windowMs, now), options);
  } catch {
    return null;
  }
};

/**
 * Spend one call if there is room. `state` is how the window stands after the
 * decision, so a refusal can say when to come back.
 */
export const consumeRollingWindow = async (
  kv: KVNamespace | undefined,
  key: string,
  options: RollingWindowOptions
): Promise<{ allowed: boolean; state: RollingWindowState | null }> => {
  if (!kv) return { allowed: true, state: null };
  const now = options.now ?? Date.now();
  try {
    const stamps = await readStamps(kv, key, options.windowMs, now);
    if (stamps.length >= options.limit) {
      return { allowed: false, state: toState(stamps, options) };
    }
    const kept = [...stamps, now].slice(-options.limit);
    await kv.put(key, JSON.stringify(kept), {
      // KV's floor is 60 s. The key only has to outlive its newest stamp.
      expirationTtl: Math.max(60, Math.ceil(options.windowMs / 1000) + 60),
    });
    return { allowed: true, state: toState(kept, options) };
  } catch {
    return { allowed: true, state: null };
  }
};

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** A positive integer from an env var, or the default. */
export const limitFromEnv = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};
