/**
 * One-line summaries of tool results, for the on-page activity panel.
 *
 * Deliberately terse and concrete — the panel is read off a screen recording,
 * so "12 results · quota 998/1000 left" beats a pretty-printed JSON blob.
 */

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const summariseToolResult = (
  toolName: string,
  result: unknown
): string => {
  if (!result || typeof result !== 'object') return 'done';
  const payload = result as Record<string, any>;

  if (payload.ok === false) {
    const error = payload.error as { code?: string; message?: string } | undefined;
    return `${error?.code ?? 'error'}: ${error?.message ?? 'failed'}`;
  }

  const parts: string[] = [];

  const resultCount =
    count(payload.count) ??
    (Array.isArray(payload.results) ? payload.results.length : null);
  if (resultCount !== null) {
    parts.push(`${resultCount} result${resultCount === 1 ? '' : 's'}`);
  }
  if (count(payload.total) !== null && toolName === 'browse_collection') {
    parts.push(`of ${payload.total} in collection`);
  }
  if (Array.isArray(payload.collections)) {
    parts.push(`${payload.collections.length} collection(s)`);
  }
  if (Array.isArray(payload.artworks)) {
    parts.push(`${payload.artworks.length} record(s)`);
  }
  if (count(payload.remaining) !== null) {
    parts.push(`quota ${payload.remaining}/${payload.limit} left`);
  }
  const quota = payload.quota as { remaining?: number; limit?: number } | null;
  if (quota && count(quota.remaining) !== null) {
    parts.push(`quota ${quota.remaining}/${quota.limit} left`);
  }
  if (typeof payload.navigatedTo === 'string') {
    parts.push(`moved the page to ${payload.navigatedTo}`);
  }
  if (count(payload.pinned) !== null) {
    parts.push(`pinned ${payload.pinned} to the canvas`);
  }
  if (payload.opened && typeof payload.opened === 'object') {
    parts.push(`opened “${payload.opened.title ?? payload.opened.id}”`);
  }
  if (payload.shortlist && typeof payload.shortlist === 'object') {
    parts.push(`shortlist “${payload.shortlist.name}”`);
    if (count(payload.added) !== null) parts.push(`+${payload.added}`);
  }
  if (payload.humanResults || payload.page) {
    const page = payload.page as { collection?: string | null } | undefined;
    const human = payload.humanResults as { count?: number } | undefined;
    parts.push(
      `read the view${page?.collection ? ` · ${page.collection}` : ''}${
        human?.count ? ` · ${human.count} on screen` : ''
      }`
    );
  }

  return parts.length ? parts.join(' · ') : 'done';
};
