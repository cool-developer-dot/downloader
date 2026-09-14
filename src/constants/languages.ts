/**
 * Scalable language catalog for VidoraX preferences.
 * Add entries here to expose new languages in the selector UI.
 * Backend allowlist must include each code before shipping.
 */

export type AppLanguage = {
  code: string;
  label: string;
  nativeLabel: string;
  /** When false, shown as Coming Soon and not selectable. */
  enabled: boolean;
  rtl: boolean;
};

/** Languages currently offered in the General → Language selector. */
export const AVAILABLE_LANGUAGES: readonly AppLanguage[] = [
  {
    code: 'en',
    label: 'English',
    nativeLabel: 'English',
    enabled: true,
    rtl: false,
  },
  {
    code: 'ur',
    label: 'Urdu',
    nativeLabel: 'اردو',
    enabled: true,
    rtl: true,
  },
] as const;

/** Full known label map (includes future / backend-supported codes). */
export const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  ur: 'Urdu',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ar: 'Arabic',
  hi: 'Hindi',
  ru: 'Russian',
  tr: 'Turkish',
  nl: 'Dutch',
  pl: 'Polish',
  sv: 'Swedish',
  id: 'Indonesian',
  vi: 'Vietnamese',
  th: 'Thai',
  uk: 'Ukrainian',
};

export const DEFAULT_LANGUAGE = 'en';

export function normalizeLanguageCode(code: string): string {
  return code.trim().toLowerCase();
}

export function isSupportedLanguage(code: string): boolean {
  const normalized = normalizeLanguageCode(code);
  return AVAILABLE_LANGUAGES.some(
    (language) => language.enabled && language.code === normalized,
  );
}

export function getLanguageLabel(code: string): string {
  const normalized = normalizeLanguageCode(code);
  return LANGUAGE_LABELS[normalized] ?? code.toUpperCase();
}

export function getEnabledLanguages(): readonly AppLanguage[] {
  return AVAILABLE_LANGUAGES.filter((language) => language.enabled);
}
