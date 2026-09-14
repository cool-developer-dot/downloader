import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type PropsWithChildren,
} from 'react';
import { useSyncExternalStore } from 'react';

import { useSettingsStore } from '@/store/settings';

import { resolveLanguage, type SupportedLanguage } from './config';
import { getRtlLayout, type RtlLayout } from './rtl';
import { translate, translatePlural } from './translate';
import type {
  PluralTranslateFn,
  TranslateFn,
  TranslationKey,
} from './types';
import { resolvePluralForms } from './plurals';

export type LocalizationValue = {
  language: SupportedLanguage;
  isRtl: boolean;
  rtl: RtlLayout;
  t: TranslateFn;
  tp: PluralTranslateFn;
};

const LocalizationContext = createContext<LocalizationValue | null>(null);

function subscribeLanguage(onChange: () => void): () => void {
  return useSettingsStore.subscribe((state, previous) => {
    if (state.language !== previous.language) {
      onChange();
    }
  });
}

function getLanguageSnapshot(): string {
  return useSettingsStore.getState().language;
}

/**
 * Single React subscription to Settings language.
 *
 * Uses React's own `useSyncExternalStore` (not Zustand's hook wrapper) so
 * language changes invalidate memoized screens under React Compiler.
 * This is not a second store — it only broadcasts `useSettingsStore.language`.
 */
export function LocalizationProvider({ children }: PropsWithChildren) {
  'use no memo';

  const rawLanguage = useSyncExternalStore(
    subscribeLanguage,
    getLanguageSnapshot,
    getLanguageSnapshot,
  );
  const language = resolveLanguage(rawLanguage);
  const rtl = useMemo(() => getRtlLayout(language), [language]);

  const t = useCallback<TranslateFn>(
    (key, params) => translate(key, params, language),
    [language],
  );

  const tp = useCallback<PluralTranslateFn>(
    (key, count, params) =>
      translatePlural(count, resolvePluralForms(key), params, language),
    [language],
  );

  const value = useMemo<LocalizationValue>(
    () => ({
      language,
      isRtl: rtl.isRtl,
      rtl,
      t,
      tp,
    }),
    [language, rtl, t, tp],
  );

  return (
    <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>
  );
}

export function useLocalizationContext(): LocalizationValue | null {
  return useContext(LocalizationContext);
}

export function languageNameKey(
  language: SupportedLanguage,
): TranslationKey {
  return language === 'ur' ? 'settings.languageNameUr' : 'settings.languageNameEn';
}
