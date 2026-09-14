import {
  AVAILABLE_LANGUAGES,
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  normalizeLanguageCode,
  type AppLanguage,
} from '@/constants/languages';

export const DEFAULT_APP_LANGUAGE = DEFAULT_LANGUAGE;

export const SUPPORTED_LANGUAGES = ['en', 'ur'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function isRtlLanguageCode(code: string): boolean {
  const normalized = normalizeLanguageCode(code);
  return AVAILABLE_LANGUAGES.some(
    (language) => language.code === normalized && language.rtl,
  );
}

export function resolveLanguage(code: string | null | undefined): SupportedLanguage {
  if (!code) {
    return DEFAULT_APP_LANGUAGE;
  }

  const normalized = normalizeLanguageCode(code);
  if (normalized === 'en' || normalized === 'ur') {
    if (isSupportedLanguage(normalized)) {
      return normalized;
    }
  }

  return DEFAULT_APP_LANGUAGE;
}

export function getSupportedLanguageCatalog(): readonly AppLanguage[] {
  return AVAILABLE_LANGUAGES.filter(
    (language) =>
      language.enabled &&
      SUPPORTED_LANGUAGES.includes(language.code as SupportedLanguage),
  );
}

export function intlLocaleForLanguage(language: SupportedLanguage): string {
  return language === 'ur' ? 'ur-PK' : 'en-US';
}
