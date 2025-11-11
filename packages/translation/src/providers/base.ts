import type { TranslationProvider, SupportedLanguage, ProviderConfig } from '../types';

/**
 * Base abstract class for translation providers
 */
export abstract class BaseTranslationProvider implements TranslationProvider {
  abstract readonly name: string;
  abstract readonly supportedLanguages: readonly SupportedLanguage[];
  abstract readonly costPerCharacter: number;

  constructor(protected config: ProviderConfig) {}

  abstract translate(
    text: string,
    sourceLang: SupportedLanguage,
    targetLang: SupportedLanguage
  ): Promise<string>;

  supports(sourceLang: SupportedLanguage, targetLang: SupportedLanguage): boolean {
    return (
      this.supportedLanguages.includes(sourceLang) &&
      this.supportedLanguages.includes(targetLang) &&
      sourceLang !== targetLang
    );
  }

  estimateCost(text: string): number {
    return text.length * this.costPerCharacter;
  }

  protected validateLanguages(
    sourceLang: SupportedLanguage,
    targetLang: SupportedLanguage
  ): void {
    if (!this.supports(sourceLang, targetLang)) {
      throw new Error(
        `${this.name} does not support translation from ${sourceLang} to ${targetLang}`
      );
    }
  }
}
