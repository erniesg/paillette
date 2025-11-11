import { BaseTranslationProvider } from './base';
import type { SupportedLanguage, ProviderConfig } from '../types';
import { TranslationError } from '../types';

/**
 * Google Translate V2 provider - excellent Tamil support
 * Best quality for English <-> Tamil translations
 */
export class GoogleTranslateProvider extends BaseTranslationProvider {
  readonly name = 'google-translate';
  readonly supportedLanguages = ['en', 'zh', 'ms', 'ta'] as const;
  readonly costPerCharacter = 0.00002; // $20 per 1M characters

  async translate(
    text: string,
    sourceLang: SupportedLanguage,
    targetLang: SupportedLanguage
  ): Promise<string> {
    this.validateLanguages(sourceLang, targetLang);

    if (!this.config.apiKey) {
      throw new TranslationError(
        'Google Translate API key not configured',
        this.name,
        'CONFIG_ERROR'
      );
    }

    try {
      const params = new URLSearchParams({
        q: text,
        source: sourceLang,
        target: targetLang,
        format: 'text',
        key: this.config.apiKey,
      });

      const response = await fetch(
        `https://translation.googleapis.com/language/translate/v2?${params.toString()}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(
          error.error?.message || `HTTP ${response.status}`
        );
      }

      const data = await response.json();
      const translatedText = data.data?.translations?.[0]?.translatedText;

      if (!translatedText) {
        throw new Error('Invalid response from Google Translate API');
      }

      // Decode HTML entities that Google might return
      return this.decodeHtmlEntities(translatedText);
    } catch (error) {
      throw new TranslationError(
        `Google Translate failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.name,
        'TRANSLATION_FAILED',
        error
      );
    }
  }

  /**
   * Decode HTML entities in translated text
   */
  private decodeHtmlEntities(text: string): string {
    const entities: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&nbsp;': ' ',
    };

    return text.replace(/&[^;]+;/g, (entity) => entities[entity] || entity);
  }
}
