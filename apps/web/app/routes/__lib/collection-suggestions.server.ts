/**
 * Derives and validates suggested search queries for a freshly indexed
 * anonymous collection (`/try`, `index_zip`, `index_folder`).
 *
 * Same contract as the NGA/NGS spotlight generator
 * (`~/lib/nga-spotlight-generator.server`): build candidate queries, run each
 * through the collection's own search, and keep only the ones that actually
 * return a hit — a suggestion is proven against the real index, not merely
 * templated. Unlike those bundles, candidates are not known ahead of time —
 * the collection is whatever the visitor just uploaded — so they are derived
 * from the collection's own search results rather than a static definitions
 * file. Artist / classification / medium / date-range candidates come from
 * the same catalogue fields a CSV sidecar populates during indexing (see
 * `parseMetadataCsv` in `~/lib/indexing-client`); a collection with too
 * little of that metadata falls back to a fixed set of broad, subject-based
 * queries, and both paths are validated the same way.
 */

import { PUBLIC_SEARCH_CONTRACT_VERSION } from '@paillette/types/public-search-core';

export type SuggestedQuerySource = 'metadata' | 'content';

export type SuggestedQuery = {
  id: string;
  label: string;
  query: string;
  source: SuggestedQuerySource;
  count: number;
};

export type CollectionSuggestions = {
  contractVersion: string;
  collectionId: string;
  jobId: string;
  generatedAt: string;
  /** True when at least one suggestion was derived from real catalogue metadata. */
  grounded: boolean;
  suggestions: SuggestedQuery[];
};

export type SuggestionSearchResult = {
  id: string;
  similarity: number;
  artist?: string | null;
  medium?: string | null;
  classification?: string | null;
  year?: number | null;
};

export type SuggestionSearchFn = (
  query: string,
  topK: number
) => Promise<SuggestionSearchResult[]>;

const MIN_SIMILARITY = 0.15;
const MAX_SUGGESTIONS = 6;
/** At least a quarter of the sample must carry a real facet for a collection to count as metadata-grounded. */
const METADATA_COVERAGE_THRESHOLD = 0.25;

/** Broad enough to hit most any art or photo collection; doubles as the no-metadata fallback. */
const SEED_QUERIES = [
  'a painting',
  'a photograph',
  'a portrait',
  'a landscape',
  'a building',
  'an object',
] as const;

type Candidate = {
  id: string;
  label: string;
  query: string;
  source: SuggestedQuerySource;
};

const titleCase = (value: string) =>
  value.length ? value[0]!.toUpperCase() + value.slice(1) : value;

const countBy = (values: string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
};

const topEntries = (counts: Map<string, number>, limit: number) =>
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value]) => value);

/** Unique, real (non-empty, trimmed) values for one facet across a result sample. */
const facetValues = (
  results: SuggestionSearchResult[],
  pick: (result: SuggestionSearchResult) => string | null | undefined
): string[] =>
  results
    .map((result) => pick(result)?.trim())
    .filter((value): value is string => Boolean(value));

const hasMetadataCoverage = (sample: SuggestionSearchResult[]) => {
  if (sample.length === 0) return false;
  const withFacet = sample.filter(
    (result) => result.artist || result.classification || result.medium
  ).length;
  return withFacet / sample.length >= METADATA_COVERAGE_THRESHOLD;
};

const buildMetadataCandidates = (sample: SuggestionSearchResult[]): Candidate[] => {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  const addCandidate = (candidate: Candidate) => {
    const key = candidate.query.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  for (const artist of topEntries(countBy(facetValues(sample, (r) => r.artist)), 2)) {
    addCandidate({
      id: `artist:${artist.toLowerCase()}`,
      label: `Works by ${artist}`,
      query: artist,
      source: 'metadata',
    });
  }

  for (const classification of topEntries(
    countBy(facetValues(sample, (r) => r.classification)),
    2
  )) {
    addCandidate({
      id: `classification:${classification.toLowerCase()}`,
      label: titleCase(classification),
      query: classification,
      source: 'metadata',
    });
  }

  for (const medium of topEntries(countBy(facetValues(sample, (r) => r.medium)), 1)) {
    addCandidate({
      id: `medium:${medium.toLowerCase()}`,
      label: titleCase(medium),
      query: medium,
      source: 'metadata',
    });
  }

  const years = sample
    .map((result) => result.year)
    .filter((year): year is number => typeof year === 'number' && Number.isFinite(year) && year > 0);
  if (years.length >= 2) {
    const min = Math.min(...years);
    const max = Math.max(...years);
    if (max > min) {
      addCandidate({
        id: `years:${min}-${max}`,
        label: `${min}–${max}`,
        query: `art from ${min} to ${max}`,
        source: 'metadata',
      });
    }
  }

  return candidates;
};

const GENERIC_CANDIDATES: Candidate[] = SEED_QUERIES.map((query) => ({
  id: `content:${query.replace(/\s+/g, '-')}`,
  label: titleCase(query),
  query,
  source: 'content',
}));

const validateCandidate = async (
  candidate: Candidate,
  search: SuggestionSearchFn
): Promise<SuggestedQuery | null> => {
  let results: SuggestionSearchResult[];
  try {
    results = await search(candidate.query, 8);
  } catch {
    return null;
  }
  const hits = results.filter((result) => result.similarity >= MIN_SIMILARITY);
  if (hits.length === 0) return null;
  return {
    id: candidate.id,
    label: candidate.label,
    query: candidate.query,
    source: candidate.source,
    count: hits.length,
  };
};

export type GenerateCollectionSuggestionsOptions = {
  jobId: string;
  collectionId: string;
  search: SuggestionSearchFn;
  now?: () => Date;
};

/**
 * Computed once per collection by the caller (the suggestions route caches
 * the result); this function itself always recomputes when called.
 */
export const generateCollectionSuggestions = async ({
  jobId,
  collectionId,
  search,
  now = () => new Date(),
}: GenerateCollectionSuggestionsOptions): Promise<CollectionSuggestions> => {
  // One search per seed query samples the collection's real metadata and
  // doubles as generic candidates when metadata turns out too thin to trust.
  const seedResults = await Promise.all(
    SEED_QUERIES.map(async (query) => ({
      query,
      results: await search(query, 12).catch(() => [] as SuggestionSearchResult[]),
    }))
  );
  const sample = seedResults.flatMap((entry) => entry.results);
  const grounded = hasMetadataCoverage(sample);

  const validated: SuggestedQuery[] = [];
  if (grounded) {
    const metadataCandidates = buildMetadataCandidates(sample);
    const results = await Promise.all(
      metadataCandidates.map((candidate) => validateCandidate(candidate, search))
    );
    validated.push(
      ...results.filter((result): result is SuggestedQuery => result !== null)
    );
  }

  // Fill out to MAX_SUGGESTIONS with generic, content-based queries — reusing
  // the seed searches already run above rather than firing them again. This
  // is the entire list when the collection has no usable metadata.
  for (const generic of GENERIC_CANDIDATES) {
    if (validated.length >= MAX_SUGGESTIONS) break;
    if (validated.some((entry) => entry.query.toLowerCase() === generic.query.toLowerCase())) {
      continue;
    }
    const seedEntry = seedResults.find((entry) => entry.query === generic.query);
    const hits = (seedEntry?.results ?? []).filter(
      (result) => result.similarity >= MIN_SIMILARITY
    );
    if (hits.length === 0) continue;
    validated.push({
      id: generic.id,
      label: generic.label,
      query: generic.query,
      source: 'content',
      count: hits.length,
    });
  }

  return {
    contractVersion: PUBLIC_SEARCH_CONTRACT_VERSION,
    collectionId,
    jobId,
    generatedAt: now().toISOString(),
    grounded,
    suggestions: validated.slice(0, MAX_SUGGESTIONS),
  };
};
