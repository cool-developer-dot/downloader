import { useMemo } from 'react';
import { useSyncExternalStore } from 'react';

import { useSettingsStore } from '@/store/settings';

import { resolveLanguage, type SupportedLanguage } from './config';
import { resolvePluralForms } from './plurals';
import {
  useLocalizationContext,
  type LocalizationValue,
} from './provider';
import { getRtlLayout, type RtlLayout } from './rtl';
import { translate, translatePlural } from './translate';
import type {
  InterpolationParams,
  PluralTranslateFn,
  TranslateFn,
  TranslationKey,
} from './types';

export type UseTranslationResult = LocalizationValue;

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

function buildLocalization(rawLanguage: string): LocalizationValue {
  const language = resolveLanguage(rawLanguage);
  const rtl = getRtlLayout(language);
  const t: TranslateFn = (key, params) => translate(key, params, language);
  const tp: PluralTranslateFn = (key, count, params) =>
    translatePlural(count, resolvePluralForms(key), params, language);

  return {
    language,
    isRtl: rtl.isRtl,
    rtl,
    t,
    tp,
  };
}

/**
 * Live translations. Prefers LocalizationProvider context (one store
 * subscription at the root). Falls back to React's useSyncExternalStore so
 * memoized screens still update when language changes — Zustand's hook
 * wrapper is not a compiler-visible external store.
 */
export function useTranslation(): UseTranslationResult {
  'use no memo';

  const ctx = useLocalizationContext();
  const rawLanguage = useSyncExternalStore(
    subscribeLanguage,
    getLanguageSnapshot,
    getLanguageSnapshot,
  );

  const fallback = useMemo(
    () => buildLocalization(rawLanguage),
    [rawLanguage],
  );

  return ctx ?? fallback;
}

export function useRtl(): RtlLayout {
  return useTranslation().rtl;
}

export type { InterpolationParams, TranslateFn, TranslationKey };
export type { SupportedLanguage };
