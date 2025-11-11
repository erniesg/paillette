/**
 * Language selector component for translation
 */

import type { Language } from '~/types';
import { Label } from '~/components/ui/label';
import { cn } from '~/lib/utils';

interface LanguageOption {
  code: Language;
  name: string;
  flag: string;
}

const LANGUAGES: LanguageOption[] = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'zh', name: 'Chinese', flag: '🇨🇳' },
  { code: 'ms', name: 'Malay', flag: '🇲🇾' },
  { code: 'ta', name: 'Tamil', flag: '🇮🇳' },
];

interface LanguageSelectorProps {
  label: string;
  value: Language;
  onChange: (language: Language) => void;
  disabled?: boolean;
  excludeLanguage?: Language;
}

export function LanguageSelector({
  label,
  value,
  onChange,
  disabled = false,
  excludeLanguage,
}: LanguageSelectorProps) {
  const availableLanguages = excludeLanguage
    ? LANGUAGES.filter((lang) => lang.code !== excludeLanguage)
    : LANGUAGES;

  return (
    <div className="space-y-2">
      <Label htmlFor={label}>{label}</Label>
      <select
        id={label}
        value={value}
        onChange={(e) => onChange(e.target.value as Language)}
        disabled={disabled}
        className={cn(
          'w-full bg-neutral-800 border-2 border-neutral-700 rounded-lg px-4 py-3 text-base text-white',
          'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'transition-all duration-200'
        )}
      >
        {availableLanguages.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.flag} {lang.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export { LANGUAGES };
