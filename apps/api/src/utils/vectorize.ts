/**
 * Cloudflare Vectorize Utilities
 * Handles vector storage and similarity search
 */

import type {
  VectorRecord,
  VectorMetadata,
  VectorSearchResult,
  SimilaritySearchOptions,
  VectorFilter,
} from '../types/embedding';

// ============================================================================
// Vectorize Index Management
// ============================================================================

/**
 * Insert a single artwork embedding into Vectorize
 */
export async function insertArtworkEmbedding(
  vectorize: VectorizeIndex,
  artworkId: string,
  embedding: number[],
  metadata: VectorMetadata
): Promise<void> {
  try {
    const vector: VectorRecord = {
      id: artworkId,
      values: embedding,
      metadata,
    };

    await vectorize.insert([vector]);
    console.log(`Inserted embedding for artwork ${artworkId}`);
  } catch (error) {
    console.error(`Failed to insert embedding for artwork ${artworkId}:`, error);
    throw error;
  }
}

/**
 * Insert multiple artwork embeddings in batch
 */
export async function insertArtworkEmbeddingsBatch(
  vectorize: VectorizeIndex,
  vectors: VectorRecord[]
): Promise<void> {
  try {
    // Vectorize supports up to 1000 vectors per batch
    const batchSize = 1000;
    const batches = [];

    for (let i = 0; i < vectors.length; i += batchSize) {
      batches.push(vectors.slice(i, i + batchSize));
    }

    for (const batch of batches) {
      await vectorize.insert(batch);
      console.log(`Inserted batch of ${batch.length} embeddings`);
    }

    console.log(`Inserted ${vectors.length} embeddings total`);
  } catch (error) {
    console.error('Failed to insert batch embeddings:', error);
    throw error;
  }
}

/**
 * Update an existing artwork embedding
 */
export async function updateArtworkEmbedding(
  vectorize: VectorizeIndex,
  artworkId: string,
  embedding: number[],
  metadata: VectorMetadata
): Promise<void> {
  try {
    // Vectorize uses upsert semantics - insert will update if exists
    await insertArtworkEmbedding(vectorize, artworkId, embedding, metadata);
    console.log(`Updated embedding for artwork ${artworkId}`);
  } catch (error) {
    console.error(`Failed to update embedding for artwork ${artworkId}:`, error);
    throw error;
  }
}

/**
 * Delete an artwork embedding
 */
export async function deleteArtworkEmbedding(
  vectorize: VectorizeIndex,
  artworkId: string
): Promise<void> {
  try {
    await vectorize.deleteByIds([artworkId]);
    console.log(`Deleted embedding for artwork ${artworkId}`);
  } catch (error) {
    console.error(`Failed to delete embedding for artwork ${artworkId}:`, error);
    throw error;
  }
}

/**
 * Delete multiple artwork embeddings
 */
export async function deleteArtworkEmbeddingsBatch(
  vectorize: VectorizeIndex,
  artworkIds: string[]
): Promise<void> {
  try {
    await vectorize.deleteByIds(artworkIds);
    console.log(`Deleted ${artworkIds.length} embeddings`);
  } catch (error) {
    console.error('Failed to delete batch embeddings:', error);
    throw error;
  }
}

// ============================================================================
// Similarity Search
// ============================================================================

/**
 * Search for similar artworks by image embedding
 */
export async function searchSimilarArtworks(
  vectorize: VectorizeIndex,
  queryEmbedding: number[],
  options: SimilaritySearchOptions = {}
): Promise<VectorSearchResult[]> {
  const {
    topK = 20,
    minScore = 0,
    filter,
    returnMetadata = true,
  } = options;

  try {
    const startTime = Date.now();

    // Build filter object for Vectorize
    const vectorizeFilter = buildVectorizeFilter(filter);

    // Query Vectorize
    const results = await vectorize.query(queryEmbedding, {
      topK: Math.min(topK, 100), // Vectorize max topK is 100
      returnMetadata: returnMetadata ? 'all' : 'none',
      filter: vectorizeFilter,
    });

    const queryTime = Date.now() - startTime;
    console.log(`Similarity search completed in ${queryTime}ms, found ${results.matches.length} results`);

    // Filter by minimum score and map to our format
    const filteredResults = results.matches
      .filter((match) => match.score >= minScore)
      .map((match) => ({
        id: match.id,
        score: match.score,
        metadata: match.metadata as VectorMetadata,
      }));

    return filteredResults;
  } catch (error) {
    console.error('Similarity search failed:', error);
    throw error;
  }
}

/**
 * Search for artworks by text query (using text embedding)
 */
export async function searchArtworksByText(
  vectorize: VectorizeIndex,
  textEmbedding: number[],
  options: SimilaritySearchOptions = {}
): Promise<VectorSearchResult[]> {
  // Text search uses the same similarity search as image
  return searchSimilarArtworks(vectorize, textEmbedding, options);
}

/**
 * Find artworks similar to a specific artwork
 */
export async function findSimilarToArtwork(
  vectorize: VectorizeIndex,
  artworkId: string,
  db: D1Database,
  options: SimilaritySearchOptions = {}
): Promise<VectorSearchResult[]> {
  try {
    // Get the artwork's embedding from Vectorize
    const results = await vectorize.getByIds([artworkId]);

    if (results.length === 0) {
      throw new Error(`Artwork ${artworkId} not found in index`);
    }

    const artwork = results[0];

    // Search for similar artworks (excluding the query artwork)
    const similarResults = await searchSimilarArtworks(
      vectorize,
      artwork.values,
      {
        ...options,
        topK: (options.topK || 20) + 1, // Get one extra to account for self
      }
    );

    // Filter out the query artwork itself
    return similarResults.filter((result) => result.id !== artworkId);
  } catch (error) {
    console.error(`Failed to find similar artworks to ${artworkId}:`, error);
    throw error;
  }
}

// ============================================================================
// Filter Building
// ============================================================================

/**
 * Build Vectorize filter from our filter options
 */
function buildVectorizeFilter(filter?: VectorFilter): Record<string, any> | undefined {
  if (!filter) {
    return undefined;
  }

  const vectorizeFilter: Record<string, any> = {};

  // Gallery ID filter
  if (filter.galleryId) {
    vectorizeFilter.galleryId = filter.galleryId;
  }

  // Artist filter
  if (filter.artist) {
    // Vectorize supports exact match on strings
    vectorizeFilter.artist = filter.artist;
  }

  // Year range filter
  if (filter.yearMin !== undefined || filter.yearMax !== undefined) {
    const yearFilter: Record<string, number> = {};

    if (filter.yearMin !== undefined) {
      yearFilter.$gte = filter.yearMin;
    }

    if (filter.yearMax !== undefined) {
      yearFilter.$lte = filter.yearMax;
    }

    if (Object.keys(yearFilter).length > 0) {
      vectorizeFilter.year = yearFilter;
    }
  }

  // Medium filter
  if (filter.medium) {
    vectorizeFilter.medium = filter.medium;
  }

  return Object.keys(vectorizeFilter).length > 0 ? vectorizeFilter : undefined;
}

// ============================================================================
// Index Statistics
// ============================================================================

/**
 * Get index statistics
 */
export async function getIndexStats(
  vectorize: VectorizeIndex
): Promise<{
  dimension: number;
  count: number;
  // Add more stats as available from Vectorize
}> {
  try {
    // Note: Vectorize API for stats might be limited
    // This is a placeholder - update based on actual API
    const info = await vectorize.describe();

    return {
      dimension: info.dimensions || 0,
      count: info.vectorsCount || 0,
    };
  } catch (error) {
    console.error('Failed to get index stats:', error);
    throw error;
  }
}

/**
 * Check if an artwork has an embedding in the index
 */
export async function hasEmbedding(
  vectorize: VectorizeIndex,
  artworkId: string
): Promise<boolean> {
  try {
    const results = await vectorize.getByIds([artworkId]);
    return results.length > 0;
  } catch (error) {
    console.error(`Failed to check embedding for artwork ${artworkId}:`, error);
    return false;
  }
}

/**
 * Get embeddings for multiple artworks
 */
export async function getEmbeddingsBatch(
  vectorize: VectorizeIndex,
  artworkIds: string[]
): Promise<Map<string, number[]>> {
  try {
    const results = await vectorize.getByIds(artworkIds);

    const embeddingsMap = new Map<string, number[]>();
    results.forEach((result) => {
      embeddingsMap.set(result.id, result.values);
    });

    return embeddingsMap;
  } catch (error) {
    console.error('Failed to get batch embeddings:', error);
    throw error;
  }
}

// ============================================================================
// Namespace Management (if using namespaces)
// ============================================================================

/**
 * Create gallery-specific namespace
 */
export function getGalleryNamespace(galleryId: string): string {
  return `gallery-${galleryId}`;
}

/**
 * Delete all embeddings for a gallery
 */
export async function deleteGalleryEmbeddings(
  vectorize: VectorizeIndex,
  galleryId: string,
  db: D1Database
): Promise<void> {
  try {
    // Get all artwork IDs for the gallery
    const artworks = await db
      .prepare('SELECT id FROM artworks WHERE gallery_id = ?')
      .bind(galleryId)
      .all<{ id: string }>();

    if (artworks.results.length === 0) {
      console.log(`No artworks found for gallery ${galleryId}`);
      return;
    }

    const artworkIds = artworks.results.map((a) => a.id);

    // Delete in batches
    await deleteArtworkEmbeddingsBatch(vectorize, artworkIds);

    console.log(`Deleted ${artworkIds.length} embeddings for gallery ${galleryId}`);
  } catch (error) {
    console.error(`Failed to delete gallery embeddings for ${galleryId}:`, error);
    throw error;
  }
}
