import { z } from 'zod';

// Supported languages
export const SupportedLanguageSchema = z.enum(['en', 'zh', 'ms', 'ta']);
export type SupportedLanguage = z.infer<typeof SupportedLanguageSchema>;

// Translation request schema
export const TranslationRequestSchema = z.object({
  text: z.string().min(1).max(50000),
  sourceLang: SupportedLanguageSchema,
  targetLang: SupportedLanguageSchema,
});

export type TranslationRequest = z.infer<typeof TranslationRequestSchema>;

// Translation result
export interface TranslationResult {
  translatedText: string;
  provider: string;
  cached: boolean;
  detectedSourceLang?: string;
  cost?: number;
}

// Provider interface
export interface TranslationProvider {
  readonly name: string;
  readonly supportedLanguages: readonly SupportedLanguage[];
  readonly costPerCharacter: number;

  /**
   * Translate text from source language to target language
   */
  translate(
    text: string,
    sourceLang: SupportedLanguage,
    targetLang: SupportedLanguage
  ): Promise<string>;

  /**
   * Check if provider supports this language pair
   */
  supports(sourceLang: SupportedLanguage, targetLang: SupportedLanguage): boolean;

  /**
   * Estimate cost for translation
   */
  estimateCost(text: string): number;
}

// Provider configuration
export interface ProviderConfig {
  apiKey?: string;
  appKey?: string;
  appSecret?: string;
  endpoint?: string;
  model?: string;
}

// Translation error
export class TranslationError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}

// Cache key generation
export function generateCacheKey(
  text: string,
  sourceLang: SupportedLanguage,
  targetLang: SupportedLanguage
): string {
  const textHash = hashString(text);
  return `translation:${textHash}:${sourceLang}:${targetLang}`;
}

// Simple hash function for cache keys
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}
