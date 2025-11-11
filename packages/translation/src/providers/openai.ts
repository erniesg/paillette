import { BaseTranslationProvider } from './base';
import type { SupportedLanguage, ProviderConfig } from '../types';
import { TranslationError } from '../types';

/**
 * OpenAI GPT-4 provider - best quality for Malay and art context
 * Used primarily for English <-> Malay translations
 */
export class OpenAIProvider extends BaseTranslationProvider {
  readonly name = 'openai';
  readonly supportedLanguages = ['en', 'zh', 'ms', 'ta'] as const;
  readonly costPerCharacter = 0.00003; // Approximate cost for GPT-4o-mini

  async translate(
    text: string,
    sourceLang: SupportedLanguage,
    targetLang: SupportedLanguage
  ): Promise<string> {
    this.validateLanguages(sourceLang, targetLang);

    if (!this.config.apiKey) {
      throw new TranslationError(
        'OpenAI API key not configured',
        this.name,
        'CONFIG_ERROR'
      );
    }

    const sourceLangName = this.getLanguageName(sourceLang);
    const targetLangName = this.getLanguageName(targetLang);

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model || 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are an expert translator specializing in art gallery and museum content. Translate accurately while preserving:
- Artistic terminology and technical terms
- Cultural nuance and context
- Proper names of artists, artworks, and movements
- Formatting (paragraphs, line breaks)

Only return the translated text without any explanations or notes.`,
            },
            {
              role: 'user',
              content: `Translate the following text from ${sourceLangName} to ${targetLangName}:\n\n${text}`,
            },
          ],
          temperature: 0.3, // Lower temperature for more consistent translations
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const translatedText = data.choices?.[0]?.message?.content;

      if (!translatedText) {
        throw new Error('Empty response from OpenAI');
      }

      return translatedText.trim();
    } catch (error) {
      throw new TranslationError(
        `OpenAI translation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.name,
        'TRANSLATION_FAILED',
        error
      );
    }
  }

  private getLanguageName(lang: SupportedLanguage): string {
    const names: Record<SupportedLanguage, string> = {
      en: 'English',
      zh: 'Mandarin Chinese',
      ms: 'Malay (Bahasa Melayu)',
      ta: 'Tamil',
    };
    return names[lang];
  }
}
