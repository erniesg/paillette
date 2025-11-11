import { BaseTranslationProvider } from './base';
import type { SupportedLanguage, ProviderConfig } from '../types';
import { TranslationError } from '../types';

/**
 * Cloudflare AI provider - free tier, decent quality
 * Used as fallback when other providers fail
 */
export class CloudflareAIProvider extends BaseTranslationProvider {
  readonly name = 'cloudflare-ai';
  readonly supportedLanguages = ['en', 'zh', 'ms', 'ta'] as const;
  readonly costPerCharacter = 0; // Free tier

  private ai: Ai;

  constructor(config: ProviderConfig & { ai: Ai }) {
    super(config);
    this.ai = config.ai;
  }

  async translate(
    text: string,
    sourceLang: SupportedLanguage,
    targetLang: SupportedLanguage
  ): Promise<string> {
    this.validateLanguages(sourceLang, targetLang);

    try {
      const response = await this.ai.run('@cf/meta/m2m100-1.2b', {
        text,
        source_lang: this.mapLanguageCode(sourceLang),
        target_lang: this.mapLanguageCode(targetLang),
      });

      if (!response || typeof response.translated_text !== 'string') {
        throw new Error('Invalid response from Cloudflare AI');
      }

      return response.translated_text;
    } catch (error) {
      throw new TranslationError(
        `Cloudflare AI translation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.name,
        'TRANSLATION_FAILED',
        error
      );
    }
  }

  /**
   * Map our language codes to Cloudflare AI format
   */
  private mapLanguageCode(lang: SupportedLanguage): string {
    const mapping: Record<SupportedLanguage, string> = {
      en: 'english',
      zh: 'chinese',
      ms: 'malay',
      ta: 'tamil',
    };
    return mapping[lang];
  }
}
