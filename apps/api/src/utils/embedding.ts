/**
 * Embedding Generation Utilities
 * Integrates with external embedding services (Replicate, Modal, etc.)
 */

import type {
  EmbeddingConfig,
  ImageEmbeddingResult,
  TextEmbeddingResult,
} from '../types/embedding';

// ============================================================================
// Configuration
// ============================================================================

export const JINA_CLIP_V2_CONFIG: EmbeddingConfig = {
  provider: 'replicate',
  model: 'jinaai/jina-clip-v2',
  dimensions: 1024,
};

export const SIGLIP_CONFIG: EmbeddingConfig = {
  provider: 'replicate',
  model: 'google/siglip-base-patch16-224',
  dimensions: 768,
};

// ============================================================================
// Replicate Integration
// ============================================================================

interface ReplicateImageEmbeddingRequest {
  input: {
    image: string; // URL or base64
    return_type: 'embedding';
  };
}

interface ReplicateTextEmbeddingRequest {
  input: {
    text: string;
    return_type: 'embedding';
  };
}

/**
 * Generate image embedding using Replicate
 */
export async function generateImageEmbeddingReplicate(
  imageUrl: string,
  apiKey: string,
  config: EmbeddingConfig = JINA_CLIP_V2_CONFIG
): Promise<ImageEmbeddingResult> {
  const startTime = Date.now();

  try {
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: getReplicateModelVersion(config.model),
        input: {
          image: imageUrl,
          task: 'retrieval.image',
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Replicate API error: ${response.status} - ${error}`);
    }

    const prediction = await response.json();

    // Poll for completion
    const embedding = await pollReplicatePrediction(prediction.id, apiKey);

    const processingTime = Date.now() - startTime;
    console.log(`Image embedding generated in ${processingTime}ms`);

    return {
      embedding,
      dimensions: config.dimensions,
      model: config.model,
      provider: 'replicate',
    };
  } catch (error) {
    console.error('Failed to generate image embedding:', error);
    throw error;
  }
}

/**
 * Generate text embedding using Replicate
 */
export async function generateTextEmbeddingReplicate(
  text: string,
  apiKey: string,
  config: EmbeddingConfig = JINA_CLIP_V2_CONFIG
): Promise<ImageEmbeddingResult> {
  const startTime = Date.now();

  try {
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: getReplicateModelVersion(config.model),
        input: {
          text,
          task: 'retrieval.query',
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Replicate API error: ${response.status} - ${error}`);
    }

    const prediction = await response.json();

    // Poll for completion
    const embedding = await pollReplicatePrediction(prediction.id, apiKey);

    const processingTime = Date.now() - startTime;
    console.log(`Text embedding generated in ${processingTime}ms`);

    return {
      embedding,
      dimensions: config.dimensions,
      model: config.model,
      provider: 'replicate',
    };
  } catch (error) {
    console.error('Failed to generate text embedding:', error);
    throw error;
  }
}

/**
 * Poll Replicate prediction until complete
 */
async function pollReplicatePrediction(
  predictionId: string,
  apiKey: string,
  maxAttempts = 60,
  intervalMs = 1000
): Promise<number[]> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(
      `https://api.replicate.com/v1/predictions/${predictionId}`,
      {
        headers: {
          'Authorization': `Token ${apiKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to poll prediction: ${response.status}`);
    }

    const prediction = await response.json();

    if (prediction.status === 'succeeded') {
      return prediction.output;
    }

    if (prediction.status === 'failed') {
      throw new Error(`Prediction failed: ${prediction.error}`);
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('Prediction timed out');
}

/**
 * Get Replicate model version
 */
function getReplicateModelVersion(model: string): string {
  const versions: Record<string, string> = {
    'jinaai/jina-clip-v2': 'latest', // Update with specific version hash
    'google/siglip-base-patch16-224': 'latest',
  };

  return versions[model] || 'latest';
}

// ============================================================================
// Cloudflare Workers AI Integration (for text)
// ============================================================================

/**
 * Generate text embedding using Cloudflare Workers AI
 */
export async function generateTextEmbeddingWorkersAI(
  ai: Ai,
  text: string,
  model: string = '@cf/baai/bge-base-en-v1.5'
): Promise<TextEmbeddingResult> {
  const startTime = Date.now();

  try {
    const response = await ai.run(model, {
      text,
    });

    const processingTime = Date.now() - startTime;
    console.log(`Text embedding generated in ${processingTime}ms (Workers AI)`);

    return {
      embedding: response.data[0] as number[],
      dimensions: getDimensionsForModel(model),
      model,
    };
  } catch (error) {
    console.error('Failed to generate text embedding (Workers AI):', error);
    throw error;
  }
}

/**
 * Generate text embeddings in batch using Workers AI
 */
export async function generateTextEmbeddingsBatchWorkersAI(
  ai: Ai,
  texts: string[],
  model: string = '@cf/baai/bge-base-en-v1.5'
): Promise<number[][]> {
  try {
    const embeddings = await Promise.all(
      texts.map(async (text) => {
        const result = await generateTextEmbeddingWorkersAI(ai, text, model);
        return result.embedding;
      })
    );

    return embeddings;
  } catch (error) {
    console.error('Failed to generate batch text embeddings:', error);
    throw error;
  }
}

/**
 * Get dimensions for Workers AI model
 */
function getDimensionsForModel(model: string): number {
  const dimensions: Record<string, number> = {
    '@cf/baai/bge-small-en-v1.5': 384,
    '@cf/baai/bge-base-en-v1.5': 768,
    '@cf/baai/bge-large-en-v1.5': 1024,
    '@cf/baai/bge-m3': 1024,
  };

  return dimensions[model] || 768;
}

// ============================================================================
// Fallback: Hugging Face Inference API
// ============================================================================

/**
 * Generate image embedding using Hugging Face Inference API
 */
export async function generateImageEmbeddingHuggingFace(
  imageUrl: string,
  apiKey: string,
  model: string = 'jinaai/jina-clip-v2'
): Promise<ImageEmbeddingResult> {
  const startTime = Date.now();

  try {
    // Fetch image data
    const imageResponse = await fetch(imageUrl);
    const imageBlob = await imageResponse.blob();

    const response = await fetch(
      `https://api-inference.huggingface.co/models/${model}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': imageBlob.type,
        },
        body: imageBlob,
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Hugging Face API error: ${response.status} - ${error}`);
    }

    const embedding = await response.json();

    const processingTime = Date.now() - startTime;
    console.log(`Image embedding generated in ${processingTime}ms (HF)`);

    return {
      embedding: Array.isArray(embedding) ? embedding : embedding.embeddings,
      dimensions: 1024, // Jina CLIP v2
      model,
      provider: 'huggingface',
    };
  } catch (error) {
    console.error('Failed to generate image embedding (HF):', error);
    throw error;
  }
}

// ============================================================================
// Generic Embedding Function
// ============================================================================

/**
 * Generate image embedding using configured provider
 */
export async function generateImageEmbedding(
  imageUrl: string,
  config: {
    provider: 'replicate' | 'huggingface';
    apiKey: string;
    model?: string;
  }
): Promise<ImageEmbeddingResult> {
  switch (config.provider) {
    case 'replicate':
      return generateImageEmbeddingReplicate(
        imageUrl,
        config.apiKey,
        config.model ? { ...JINA_CLIP_V2_CONFIG, model: config.model } : JINA_CLIP_V2_CONFIG
      );

    case 'huggingface':
      return generateImageEmbeddingHuggingFace(
        imageUrl,
        config.apiKey,
        config.model || 'jinaai/jina-clip-v2'
      );

    default:
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
}

/**
 * Validate embedding dimensions
 */
export function validateEmbedding(
  embedding: number[],
  expectedDimensions: number
): boolean {
  if (!Array.isArray(embedding)) {
    return false;
  }

  if (embedding.length !== expectedDimensions) {
    console.warn(
      `Embedding dimension mismatch: expected ${expectedDimensions}, got ${embedding.length}`
    );
    return false;
  }

  // Check for NaN or Infinity
  if (embedding.some((value) => !isFinite(value))) {
    console.warn('Embedding contains invalid values (NaN or Infinity)');
    return false;
  }

  return true;
}

/**
 * Normalize embedding vector (L2 normalization)
 */
export function normalizeEmbedding(embedding: number[]): number[] {
  const magnitude = Math.sqrt(
    embedding.reduce((sum, value) => sum + value * value, 0)
  );

  if (magnitude === 0) {
    return embedding;
  }

  return embedding.map((value) => value / magnitude);
}
