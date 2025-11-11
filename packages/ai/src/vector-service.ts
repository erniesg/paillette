import {
  VectorServiceConfig,
  VectorUpsertOptions,
  VectorSearchOptions,
  VectorSearchResult,
  DEFAULT_TOP_K,
  DEFAULT_VECTOR_DIMENSIONS,
} from './types';

/**
 * Service for managing vectors in Cloudflare Vectorize
 * Handles vector storage, search, and deletion operations
 */
export class VectorService {
  private vectorize: Vectorize;
  private indexName: string;
  private expectedDimensions: number;

  constructor(config: VectorServiceConfig) {
    this.vectorize = config.vectorize;
    this.indexName = config.indexName || 'artwork-embeddings';
    this.expectedDimensions = DEFAULT_VECTOR_DIMENSIONS;
  }

  /**
   * Store or update a single vector
   * @param options - Vector upsert options
   * @returns Promise with success status and vector ID
   */
  async upsertVector(
    options: VectorUpsertOptions
  ): Promise<{ success: boolean; id: string }> {
    try {
      // Validate vector dimensions
      if (options.values.length !== this.expectedDimensions) {
        throw new Error(
          `Vector dimensions must be ${this.expectedDimensions}, got ${options.values.length}`
        );
      }

      // Upsert the vector
      const result = await this.vectorize.upsert([
        {
          id: options.id,
          values: options.values,
          metadata: options.metadata,
        },
      ]);

      return {
        success: true,
        id: options.id,
      };
    } catch (error) {
      console.error('Failed to upsert vector:', error);
      throw new Error(
        `Failed to upsert vector: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Store or update multiple vectors in batch
   * @param vectors - Array of vectors to upsert
   * @returns Promise with success status, count, and IDs
   */
  async upsertBatch(
    vectors: VectorUpsertOptions[]
  ): Promise<{ success: boolean; count: number; ids: string[] }> {
    try {
      // Validate batch
      if (!vectors || vectors.length === 0) {
        throw new Error('Batch cannot be empty');
      }

      // Validate all vector dimensions
      for (const vector of vectors) {
        if (vector.values.length !== this.expectedDimensions) {
          throw new Error(
            `Vector ${vector.id} has wrong dimensions: ${vector.values.length}, expected ${this.expectedDimensions}`
          );
        }
      }

      // Upsert all vectors
      const result = await this.vectorize.upsert(
        vectors.map((v) => ({
          id: v.id,
          values: v.values,
          metadata: v.metadata,
        }))
      );

      return {
        success: true,
        count: result.count,
        ids: result.ids,
      };
    } catch (error) {
      console.error('Failed to upsert batch:', error);
      throw new Error(
        `Failed to upsert batch: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Search for similar vectors
   * @param queryVector - Query embedding vector
   * @param options - Search options
   * @returns Promise<VectorSearchResult[]>
   */
  async search(
    queryVector: number[],
    options?: VectorSearchOptions
  ): Promise<VectorSearchResult[]> {
    try {
      const {
        topK = DEFAULT_TOP_K,
        galleryId,
        minScore = 0,
        includeMetadata = true,
      } = options || {};

      // Build filter object
      const filter: Record<string, any> = {};
      if (galleryId) {
        filter.galleryId = galleryId;
      }

      // Query Vectorize
      const result = await this.vectorize.query(queryVector, {
        topK,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        returnMetadata: includeMetadata,
      });

      // Filter by minimum score and transform results
      const matches = result.matches
        .filter((match) => match.score >= minScore)
        .map((match) => ({
          id: match.id,
          score: match.score,
          metadata: includeMetadata ? match.metadata : undefined,
        }));

      return matches as VectorSearchResult[];
    } catch (error) {
      console.error('Failed to search vectors:', error);
      throw new Error(
        `Failed to search vectors: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Retrieve vectors by their IDs
   * @param ids - Array of vector IDs
   * @returns Promise with vector data
   */
  async getByIds(ids: string[]): Promise<any[]> {
    try {
      const vectors = await this.vectorize.getByIds(ids);
      return vectors;
    } catch (error) {
      console.error('Failed to get vectors by IDs:', error);
      throw new Error(
        `Failed to get vectors: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Delete a single vector by ID
   * @param id - Vector ID to delete
   * @returns Promise with success status and deleted ID
   */
  async deleteVector(
    id: string
  ): Promise<{ success: boolean; deletedId: string }> {
    try {
      await this.vectorize.deleteByIds([id]);
      return {
        success: true,
        deletedId: id,
      };
    } catch (error) {
      console.error('Failed to delete vector:', error);
      throw new Error(
        `Failed to delete vector: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Delete multiple vectors by IDs
   * @param ids - Array of vector IDs to delete
   * @returns Promise with success status and count
   */
  async deleteBatch(
    ids: string[]
  ): Promise<{ success: boolean; count: number }> {
    try {
      const result = await this.vectorize.deleteByIds(ids);
      return {
        success: true,
        count: result.count,
      };
    } catch (error) {
      console.error('Failed to delete batch:', error);
      throw new Error(
        `Failed to delete batch: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
