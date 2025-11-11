import type {
  SupportedLanguage,
  TranslationProvider,
  TranslationResult,
  ProviderConfig,
} from './types';
import { TranslationError, generateCacheKey } from './types';
import { CloudflareAIProvider } from './providers/cloudflare-ai';
import { OpenAIProvider } from './providers/openai';
import { YoudaoProvider } from './providers/youdao';
import { GoogleTranslateProvider } from './providers/google-translate';

export interface TranslationServiceConfig {
  ai: Ai;
  cache?: KVNamespace;
  cacheTTL?: number;
  openaiApiKey?: string;
  youdaoAppKey?: string;
  youdaoAppSecret?: string;
  googleApiKey?: string;
}

/**
 * Main translation service that routes to optimal providers
 * and handles caching + fallbacks
 */
export class TranslationService {
  private providers: Map<string, TranslationProvider>;
  private fallbackProvider: TranslationProvider;
  private cache?: KVNamespace;
  private cacheTTL: number;

  // Provider routing strategy based on target language
  private readonly providerStrategy: Record<SupportedLanguage, string[]> = {
    en: ['openai', 'cloudflare-ai'], // Generic, use any
    zh: ['youdao', 'openai', 'cloudflare-ai'], // Prefer Youdao for Chinese
    ms: ['openai', 'cloudflare-ai'], // Prefer OpenAI for Malay
    ta: ['google-translate', 'openai', 'cloudflare-ai'], // Prefer Google for Tamil
  };

  constructor(config: TranslationServiceConfig) {
    this.cache = config.cache;
    this.cacheTTL = config.cacheTTL || 2592000; // 30 days default

    // Initialize providers
    this.providers = new Map();

    // Cloudflare AI (always available, free)
    const cloudflareAI = new CloudflareAIProvider({ ai: config.ai });
    this.providers.set(cloudflareAI.name, cloudflareAI);
    this.fallbackProvider = cloudflareAI;

    // OpenAI (if configured)
    if (config.openaiApiKey) {
      const openai = new OpenAIProvider({
        apiKey: config.openaiApiKey,
        model: 'gpt-4o-mini',
      });
      this.providers.set(openai.name, openai);
    }

    // Youdao (if configured)
    if (config.youdaoAppKey && config.youdaoAppSecret) {
      const youdao = new YoudaoProvider({
        appKey: config.youdaoAppKey,
        appSecret: config.youdaoAppSecret,
      });
      this.providers.set(youdao.name, youdao);
    }

    // Google Translate (if configured)
    if (config.googleApiKey) {
      const google = new GoogleTranslateProvider({
        apiKey: config.googleApiKey,
      });
      this.providers.set(google.name, google);
    }
  }

  /**
   * Translate text with automatic provider selection and fallback
   */
  async translate(
    text: string,
    sourceLang: SupportedLanguage,
    targetLang: SupportedLanguage
  ): Promise<TranslationResult> {
    // Validate inputs
    if (!text || text.trim().length === 0) {
      throw new TranslationError(
        'Text cannot be empty',
        'translation-service',
        'VALIDATION_ERROR'
      );
    }

    if (sourceLang === targetLang) {
      return {
        translatedText: text,
        provider: 'none',
        cached: false,
      };
    }

    // Check cache first
    if (this.cache) {
      const cached = await this.getCached(text, sourceLang, targetLang);
      if (cached) {
        return {
          translatedText: cached,
          provider: 'cache',
          cached: true,
        };
      }
    }

    // Get provider strategy for target language
    const providerNames = this.providerStrategy[targetLang];

    // Try providers in order of preference
    let lastError: TranslationError | null = null;

    for (const providerName of providerNames) {
      const provider = this.providers.get(providerName);

      if (!provider || !provider.supports(sourceLang, targetLang)) {
        continue;
      }

      try {
        const translatedText = await provider.translate(text, sourceLang, targetLang);

        // Cache successful translation
        if (this.cache) {
          await this.setCached(text, sourceLang, targetLang, translatedText);
        }

        return {
          translatedText,
          provider: provider.name,
          cached: false,
          cost: provider.estimateCost(text),
        };
      } catch (error) {
        console.warn(
          `Provider ${providerName} failed, trying next:`,
          error instanceof Error ? error.message : 'Unknown error'
        );
        lastError =
          error instanceof TranslationError
            ? error
            : new TranslationError(
                `Provider ${providerName} failed`,
                providerName,
                'PROVIDER_ERROR',
                error
              );
      }
    }

    // All providers failed, throw last error
    throw (
      lastError ||
      new TranslationError(
        'No suitable translation provider available',
        'translation-service',
        'NO_PROVIDER'
      )
    );
  }

  /**
   * Batch translate multiple texts
   */
  async translateBatch(
    texts: string[],
    sourceLang: SupportedLanguage,
    targetLang: SupportedLanguage
  ): Promise<TranslationResult[]> {
    return Promise.all(
      texts.map((text) => this.translate(text, sourceLang, targetLang))
    );
  }

  /**
   * Estimate cost for translation
   */
  estimateCost(
    text: string,
    targetLang: SupportedLanguage
  ): { provider: string; cost: number } {
    const providerNames = this.providerStrategy[targetLang];
    const providerName = providerNames[0]; // Use primary provider
    const provider = this.providers.get(providerName);

    if (!provider) {
      return { provider: 'unknown', cost: 0 };
    }

    return {
      provider: provider.name,
      cost: provider.estimateCost(text),
    };
  }

  /**
   * Get translation from cache
   */
  private async getCached(
    text: string,
    sourceLang: SupportedLanguage,
    targetLang: SupportedLanguage
  ): Promise<string | null> {
    if (!this.cache) return null;

    const key = generateCacheKey(text, sourceLang, targetLang);
    return await this.cache.get(key, 'text');
  }

  /**
   * Store translation in cache
   */
  private async setCached(
    text: string,
    sourceLang: SupportedLanguage,
    targetLang: SupportedLanguage,
    translatedText: string
  ): Promise<void> {
    if (!this.cache) return;

    const key = generateCacheKey(text, sourceLang, targetLang);
    await this.cache.put(key, translatedText, {
      expirationTtl: this.cacheTTL,
    });
  }

  /**
   * Get available providers
   */
  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}
