import { DEFAULT_APP_LANGUAGE, resolveLanguage, type SupportedLanguage } from './config';
import { en } from './en';
import {
  flattenCatalog,
  humanizeKey,
  lookupCatalogValue,
  type CatalogStrings,
  type InterpolationParams,
  type TranslationCatalog,
  type TranslationKey,
} from './types';
import { ur } from './ur';

const catalogs: Record<SupportedLanguage, CatalogStrings<TranslationCatalog>> = {
  en,
  ur,
};

const flattenedCatalogs: Record<SupportedLanguage, Record<string, string>> = {
  en: flattenCatalog(en),
  ur: flattenCatalog(ur),
};

const missingWarnings = new Set<string>();

type LanguageReader = () => string | null | undefined;

let languageReader: LanguageReader = () => DEFAULT_APP_LANGUAGE;

/** Bind to settings store from app bootstrap — keeps Node verifiers RN-free. */
export function bindLanguageReader(reader: LanguageReader): void {
  languageReader = reader;
}

function interpolate(template: string, params?: InterpolationParams): string {
  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export function getActiveLanguage(): SupportedLanguage {
  return resolveLanguage(languageReader());
}

export function getCatalog(
  language: SupportedLanguage = getActiveLanguage(),
): CatalogStrings<TranslationCatalog> {
  return catalogs[language] ?? catalogs[DEFAULT_APP_LANGUAGE];
}

export function getFlattenedCatalog(
  language: SupportedLanguage = getActiveLanguage(),
): Record<string, string> {
  return flattenedCatalogs[language] ?? flattenedCatalogs[DEFAULT_APP_LANGUAGE];
}

function warnMissingOnce(language: SupportedLanguage, key: string): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  const id = `${language}:${key}`;
  if (missingWarnings.has(id)) {
    return;
  }
  missingWarnings.add(id);
  console.warn(`[i18n] Missing translation "${key}" for ${language}`);
}

export function translate(
  key: TranslationKey,
  params?: InterpolationParams,
  language: SupportedLanguage = getActiveLanguage(),
): string {
  const requested = flattenedCatalogs[language]?.[key] ?? lookupCatalogValue(catalogs[language], key);
  if (requested) {
    return interpolate(requested, params);
  }

  if (language !== DEFAULT_APP_LANGUAGE) {
    warnMissingOnce(language, key);
    const english =
      flattenedCatalogs.en[key] ?? lookupCatalogValue(catalogs.en, key);
    if (english) {
      return interpolate(english, params);
    }
  } else {
    warnMissingOnce(language, key);
  }

  return interpolate(humanizeKey(key), params);
}

export function translatePlural(
  count: number,
  forms: { zero?: TranslationKey; one: TranslationKey; other: TranslationKey },
  params?: InterpolationParams,
  language: SupportedLanguage = getActiveLanguage(),
): string {
  const key =
    count === 0 && forms.zero
      ? forms.zero
      : count === 1
        ? forms.one
        : forms.other;
  return translate(key, { count, ...params }, language);
}

export function hasTranslationKey(
  key: string,
  language: SupportedLanguage = DEFAULT_APP_LANGUAGE,
): boolean {
  return Boolean(flattenedCatalogs[language]?.[key]);
}
