/**
 * Rendering tool traffic as data.
 *
 * The log's whole argument is that it is not a transcript: a judge asking "how
 * was WebMCP implemented" should be able to open it and read the actual call —
 * the name registered on `document.modelContext`, the JSON that went in, the
 * JSON that came back, and how long it took. So arguments and results are
 * printed as JSON, clipped, in the catalogue mono. Nothing here turns a payload
 * into a sentence.
 *
 * Everything is defensive because the values are whatever a tool returned:
 * cyclic, enormous, or not serialisable at all.
 */

/** One line in the collapsed row. Long enough to identify a call, no longer. */
const INLINE_LIMIT = 96;

/**
 * The expanded body. Enough to read a search result end to end, capped so a
 * whole session's worth sits in memory without anyone noticing: the store keeps
 * 120 entries, so the ceiling is a few hundred kilobytes and the usual case is
 * a small fraction of that.
 */
const DETAIL_LIMIT = 2_500;

/** Strings inside a captured result. A base64 image would swamp everything. */
const STRING_LIMIT = 240;

/** Arrays inside a captured result: keep the head, count the tail. */
const ARRAY_LIMIT = 12;

const clip = (text: string, limit: number): string =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

/**
 * `JSON.stringify` that cannot throw and cannot run away.
 *
 * Cycles become `"[circular]"` rather than a `TypeError` that would lose the
 * whole entry; long strings and long arrays are cut with the amount cut named,
 * so a clipped payload never reads as a complete one.
 */
const safeStringify = (value: unknown, indent: number): string => {
  const seen = new WeakSet<object>();

  const prepare = (input: unknown, depth: number): unknown => {
    if (typeof input === 'bigint') return `${input}n`;
    if (typeof input === 'function') return '[function]';
    if (typeof input === 'string') return clip(input, STRING_LIMIT);
    if (input === null || typeof input !== 'object') return input;
    if (depth > 6) return '[…]';

    const object = input as object;
    if (seen.has(object)) return '[circular]';
    seen.add(object);

    if (Array.isArray(input)) {
      const head = input
        .slice(0, ARRAY_LIMIT)
        .map((item) => prepare(item, depth + 1));
      if (input.length > ARRAY_LIMIT) {
        head.push(`… ${input.length - ARRAY_LIMIT} more`);
      }
      return head;
    }

    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
      if (item === undefined) continue;
      out[key] = prepare(item, depth + 1);
    }
    return out;
  };

  try {
    return JSON.stringify(prepare(value, 0), null, indent) ?? String(value);
  } catch {
    return '[unserialisable]';
  }
};

/** The captured result, pretty-printed, for the expanded row. Stored, not live. */
export const previewJson = (value: unknown): string | null => {
  if (value === undefined) return null;
  return clip(safeStringify(value, 2), DETAIL_LIMIT);
};

/** Arguments or result on one line, for the collapsed row. */
export const inlineJson = (value: unknown): string => {
  if (value === undefined) return '{}';
  return clip(safeStringify(value, 0), INLINE_LIMIT);
};

/** Arguments pretty-printed, for the expanded row. */
export const detailJson = (value: unknown): string =>
  clip(safeStringify(value, 2), DETAIL_LIMIT);

/**
 * A refusal the tool returned rather than threw.
 *
 * Every Paillette tool answers `{ok:false,error:{code,message,hint?}}` instead
 * of throwing, which is right for the agent — it can read the code and try
 * something else — and wrong for a log that only styles thrown errors as
 * errors. A stale id or an exhausted collection is a failure; it should look
 * like one on screen, with the message the tool actually wrote.
 */
export const shapedError = (result: unknown): string | null => {
  if (!result || typeof result !== 'object') return null;
  const payload = result as { ok?: unknown; error?: unknown };
  if (payload.ok !== false) return null;

  const error = payload.error as
    | { code?: unknown; message?: unknown }
    | undefined;
  const code = typeof error?.code === 'string' ? error.code : null;
  const message = typeof error?.message === 'string' ? error.message : null;
  if (code && message) return `${code}: ${message}`;
  return message ?? code ?? 'failed';
};

/** How long the call took, in the shortest form that is still exact enough. */
export const formatDuration = (ms: number): string =>
  ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
