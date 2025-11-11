import {
  EmbeddingServiceConfig,
  EmbeddingResult,
  EMBEDDING_MODELS,
  DEFAULT_VECTOR_DIMENSIONS,
} from './types';

/**
 * Service for generating embeddings using Cloudflare AI
 * Supports both image and text embeddings with configurable models
 */
export class EmbeddingService {
  private ai: Ai;
  private imageModel: string;
  private textModel: string;

  constructor(config: EmbeddingServiceConfig) {
    this.ai = config.ai;
    this.imageModel = config.imageModel || EMBEDDING_MODELS.IMAGE_JINA_CLIP_V2;
    this.textModel = config.textModel || EMBEDDING_MODELS.TEXT_BGE;
  }

  /**
   * Generate embedding for an image
   * @param imageData - Image data as ArrayBuffer
   * @returns Promise<EmbeddingResult>
   * @throws Error if image data is empty or generation fails
   */
  async generateImageEmbedding(
    imageData: ArrayBuffer
  ): Promise<EmbeddingResult> {
    const startTime = performance.now();

    try {
      // Validate input
      if (!imageData || imageData.byteLength === 0) {
        throw new Error('Image data cannot be empty');
      }

      // Convert ArrayBuffer to Uint8Array for processing
      const imageArray = Array.from(new Uint8Array(imageData));

      // Call Cloudflare AI to generate embedding
      const result = await this.ai.run(this.imageModel, {
        image: imageArray,
      });

      // Extract embedding from result
      const embedding = result.data[0] as number[];

      if (!embedding || embedding.length === 0) {
        throw new Error('Received empty embedding from AI service');
      }

      const durationMs = performance.now() - startTime;

      // Determine dimensions based on model
      const dimensions = this.getModelDimensions(this.imageModel);

      return {
        embedding,
        dimensions,
        model: this.imageModel,
        durationMs,
      };
    } catch (error) {
      console.error('Failed to generate image embedding:', error);
      throw new Error(
        `Failed to generate image embedding: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Generate embedding for text
   * @param text - Text query string
   * @returns Promise<EmbeddingResult>
   * @throws Error if text is empty or generation fails
   */
  async generateTextEmbedding(text: string): Promise<EmbeddingResult> {
    const startTime = performance.now();

    try {
      // Validate and normalize input
      const normalizedText = this.normalizeText(text);

      if (!normalizedText || normalizedText.length === 0) {
        throw new Error('Text query cannot be empty');
      }

      // Truncate to max token length (approximation: 512 tokens ~2048 chars)
      const truncatedText =
        normalizedText.length > 2048
          ? normalizedText.substring(0, 2048)
          : normalizedText;

      // Call Cloudflare AI to generate embedding
      const result = await this.ai.run(this.textModel, {
        text: truncatedText,
      });

      // Extract embedding from result
      const embedding = result.data[0] as number[];

      if (!embedding || embedding.length === 0) {
        throw new Error('Received empty embedding from AI service');
      }

      const durationMs = performance.now() - startTime;

      // Determine dimensions based on model
      const dimensions = this.getModelDimensions(this.textModel);

      return {
        embedding,
        dimensions,
        model: this.textModel,
        durationMs,
      };
    } catch (error) {
      console.error('Failed to generate text embedding:', error);
      throw new Error(
        `Failed to generate text embedding: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Generate embeddings for multiple images in batch
   * @param images - Array of image data as ArrayBuffers
   * @param options - Batch processing options
   * @returns Promise<(EmbeddingResult | null)[]>
   */
  async generateBatchEmbeddings(
    images: ArrayBuffer[],
    options?: { continueOnError?: boolean }
  ): Promise<(EmbeddingResult | null)[]> {
    const { continueOnError = false } = options || {};

    const promises = images.map(async (imageData) => {
      try {
        return await this.generateImageEmbedding(imageData);
      } catch (error) {
        if (continueOnError) {
          console.warn('Failed to generate embedding in batch:', error);
          return null;
        }
        throw error;
      }
    });

    return await Promise.all(promises);
  }

  /**
   * Normalize text by trimming and collapsing whitespace
   * @param text - Raw text input
   * @returns Normalized text
   */
  private normalizeText(text: string): string {
    return text
      .trim()
      .replace(/\s+/g, ' ') // Collapse multiple whitespace to single space
      .replace(/\n|\r|\t/g, ' '); // Replace newlines and tabs with space
  }

  /**
   * Get the dimensions for a given model
   * @param model - Model identifier
   * @returns Number of dimensions
   */
  private getModelDimensions(model: string): number {
    switch (model) {
      case EMBEDDING_MODELS.IMAGE_CLIP:
        return 512;
      case EMBEDDING_MODELS.IMAGE_JINA_CLIP_V2:
        return 1024;
      case EMBEDDING_MODELS.TEXT_BGE:
        return 768;
      case EMBEDDING_MODELS.TEXT_SMALL:
        return 384;
      default:
        return DEFAULT_VECTOR_DIMENSIONS;
    }
  }
}
