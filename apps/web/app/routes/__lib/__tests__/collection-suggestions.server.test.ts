import { describe, expect, it, vi } from 'vitest';
import { PUBLIC_SEARCH_CONTRACT_VERSION } from '@paillette/types/public-search-core';
import {
  generateCollectionSuggestions,
  type SuggestionSearchResult,
} from '../collection-suggestions.server';

const JOB_ID = 'job-1';
const COLLECTION_ID = 'collection-1';

const METADATA_RESULT: SuggestionSearchResult = {
  id: 'a1',
  similarity: 0.5,
  artist: 'Rembrandt van Rijn',
  medium: 'Oil on canvas',
  classification: 'Painting',
  year: 1650,
};

const CONTENT_ONLY_RESULT: SuggestionSearchResult = {
  id: 'b1',
  similarity: 0.4,
  artist: null,
  medium: null,
  classification: null,
  year: null,
};

describe('generateCollectionSuggestions', () => {
  it('derives metadata-grounded candidates when the sample carries real catalogue fields', async () => {
    const search = vi.fn(async () => [METADATA_RESULT]);

    const bundle = await generateCollectionSuggestions({
      jobId: JOB_ID,
      collectionId: COLLECTION_ID,
      search,
    });

    expect(bundle.contractVersion).toBe(PUBLIC_SEARCH_CONTRACT_VERSION);
    expect(bundle.jobId).toBe(JOB_ID);
    expect(bundle.collectionId).toBe(COLLECTION_ID);
    expect(bundle.grounded).toBe(true);

    const metadataSuggestions = bundle.suggestions.filter(
      (s) => s.source === 'metadata'
    );
    expect(metadataSuggestions.length).toBeGreaterThan(0);
    const metadataQueries = metadataSuggestions.map((s) => s.query);
    expect(metadataQueries).toContain('Rembrandt van Rijn');
    expect(metadataQueries).toContain('Painting');
    expect(metadataQueries).toContain('Oil on canvas');
    // Real catalogue candidates fill the bundle first; generic queries only
    // top it up, and every suggestion in either source must be non-empty.
    expect(bundle.suggestions.length).toBeGreaterThan(0);
    expect(bundle.suggestions.length).toBeLessThanOrEqual(6);
    for (const suggestion of bundle.suggestions) {
      expect(suggestion.query.trim().length).toBeGreaterThan(0);
      expect(suggestion.count).toBeGreaterThan(0);
    }
  });

  it('falls back to generic content queries when the collection has no usable metadata', async () => {
    const search = vi.fn(async () => [CONTENT_ONLY_RESULT]);

    const bundle = await generateCollectionSuggestions({
      jobId: JOB_ID,
      collectionId: COLLECTION_ID,
      search,
    });

    expect(bundle.grounded).toBe(false);
    expect(bundle.suggestions.length).toBeGreaterThan(0);
    expect(bundle.suggestions.every((s) => s.source === 'content')).toBe(true);
  });

  it('drops a collection so thin that nothing validates, without throwing', async () => {
    const search = vi.fn(async () => []);

    const bundle = await generateCollectionSuggestions({
      jobId: JOB_ID,
      collectionId: COLLECTION_ID,
      search,
    });

    expect(bundle.grounded).toBe(false);
    expect(bundle.suggestions).toEqual([]);
  });

  it('drops a candidate whose only hits fall below the similarity floor', async () => {
    const search = vi.fn(async () => [{ ...CONTENT_ONLY_RESULT, similarity: 0.01 }]);

    const bundle = await generateCollectionSuggestions({
      jobId: JOB_ID,
      collectionId: COLLECTION_ID,
      search,
    });

    expect(bundle.suggestions).toEqual([]);
  });

  it('never rejects when one candidate search throws', async () => {
    let calls = 0;
    const search = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return [METADATA_RESULT];
    });

    await expect(
      generateCollectionSuggestions({
        jobId: JOB_ID,
        collectionId: COLLECTION_ID,
        search,
      })
    ).resolves.toBeDefined();
  });

  it('deduplicates a metadata candidate that collides with a generic query', async () => {
    // Every seed query and every candidate returns the same fixture — this
    // just proves duplicate query text never appears twice in the bundle.
    const search = vi.fn(async () => [METADATA_RESULT]);
    const bundle = await generateCollectionSuggestions({
      jobId: JOB_ID,
      collectionId: COLLECTION_ID,
      search,
    });
    const queries = bundle.suggestions.map((s) => s.query.toLowerCase());
    expect(new Set(queries).size).toBe(queries.length);
  });
});
