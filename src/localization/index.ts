export {
  DEFAULT_APP_LANGUAGE,
  SUPPORTED_LANGUAGES,
  getSupportedLanguageCatalog,
  intlLocaleForLanguage,
  isRtlLanguageCode,
  resolveLanguage,
  type SupportedLanguage,
} from './config';
export { en } from './en';
export { ur } from './ur';
export {
  localizeApiErrorCode,
  localizeDownloadErrorCode,
  localizePlayerError,
  localizeUnknownError,
} from './errors';
export {
  getRtlLayout,
  marginStartStyle,
  resolveDirectionalIcon,
  startEndStyle,
  type RtlLayout,
} from './rtl';
export {
  bindLanguageReader,
  getActiveLanguage,
  getCatalog,
  getFlattenedCatalog,
  hasTranslationKey,
  translate,
  translatePlural,
} from './translate';
export {
  flattenCatalog,
  humanizeKey,
  lookupCatalogValue,
  type CatalogStrings,
  type InterpolationParams,
  type TranslateFn,
  type TranslationCatalog,
  type TranslationKey,
} from './types';
export {
  languageNameKey,
  LocalizationProvider,
} from './provider';
export { useRtl, useTranslation } from './use-translation';
