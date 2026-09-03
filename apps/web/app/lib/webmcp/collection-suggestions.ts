/**
 * Suggested searches for a collection an indexing job just built, computed
 * server-side once per collection (`apps/api/src/routes/indexing.ts`) and
 * carried on the job status payload.
 *
 * `IndexStatus` (in `~/lib/indexing-client`, owned by the indexing-client
 * work) does not declare this field, so it is read here as an additive
 * extension of that response rather than by editing that type.
 */

export type CollectionSuggestion = {
  id: string;
  type: 'artist' | 'classification' | 'medium' | 'era' | 'keyword';
  label: string;
  query: string;
};

export type CollectionSuggestions = {
  /** Whether these came from real catalogue metadata or just filenames. */
  source: 'metadata' | 'filenames';
  generatedAt: string;
  suggestions: CollectionSuggestion[];
};

export const getCollectionSuggestions = (
  status: unknown
): CollectionSuggestions | null => {
  if (!status || typeof status !== 'object' || !('suggestions' in status)) {
    return null;
  }
  const suggestions = (status as { suggestions?: unknown }).suggestions;
  return suggestions && typeof suggestions === 'object'
    ? (suggestions as CollectionSuggestions)
    : null;
};
