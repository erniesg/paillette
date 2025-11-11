import { BaseTranslationProvider } from './base';
import type { SupportedLanguage, ProviderConfig } from '../types';
import { TranslationError } from '../types';

/**
 * Youdao API provider - specialized for Chinese translations
 * Best quality for English <-> Mandarin with cultural context
 */
export class YoudaoProvider extends BaseTranslationProvider {
  readonly name = 'youdao';
  readonly supportedLanguages = ['en', 'zh'] as const;
  readonly costPerCharacter = 0.00001; // Very affordable

  async translate(
    text: string,
    sourceLang: SupportedLanguage,
    targetLang: SupportedLanguage
  ): Promise<string> {
    this.validateLanguages(sourceLang, targetLang);

    if (!this.config.appKey || !this.config.appSecret) {
      throw new TranslationError(
        'Youdao API credentials not configured',
        this.name,
        'CONFIG_ERROR'
      );
    }

    const salt = Date.now().toString();
    const curtime = Math.floor(Date.now() / 1000).toString();

    // Truncate text for sign calculation (per Youdao API spec)
    const truncatedText = this.truncate(text);

    // Generate signature
    const signStr = `${this.config.appKey}${truncatedText}${salt}${curtime}${this.config.appSecret}`;
    const sign = await this.sha256(signStr);

    try {
      const params = new URLSearchParams({
        q: text,
        from: this.mapLanguageCode(sourceLang),
        to: this.mapLanguageCode(targetLang),
        appKey: this.config.appKey,
        salt,
        sign,
        signType: 'v3',
        curtime,
      });

      const response = await fetch('https://openapi.youdao.com/api', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.errorCode !== '0') {
        throw new Error(`Youdao API error: ${data.errorCode}`);
      }

      if (!data.translation || !Array.isArray(data.translation) || data.translation.length === 0) {
        throw new Error('Invalid response from Youdao API');
      }

      return data.translation.join('\n');
    } catch (error) {
      throw new TranslationError(
        `Youdao translation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.name,
        'TRANSLATION_FAILED',
        error
      );
    }
  }

  /**
   * Truncate text for signature calculation (Youdao spec)
   */
  private truncate(text: string): string {
    const len = text.length;
    if (len <= 20) {
      return text;
    }
    return text.substring(0, 10) + len + text.substring(len - 10);
  }

  /**
   * SHA256 hash for signature
   */
  private async sha256(message: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Map language codes to Youdao format
   */
  private mapLanguageCode(lang: SupportedLanguage): string {
    const mapping: Record<string, string> = {
      en: 'en',
      zh: 'zh-CHS', // Simplified Chinese
    };
    return mapping[lang] || lang;
  }
}
