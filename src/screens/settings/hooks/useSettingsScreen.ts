import { useCallback, useEffect, useRef, useState } from 'react';

import { timeouts } from '@/constants';
import type { TranslationKey } from '@/localization';
import { selectLanguage, useSettingsStore } from '@/store/settings';
import {
  updateLanguagePreference,
  updateThemePreference,
} from '@/services/auth/settings.service';
import { selectThemeMode, useThemeStore } from '@/store/theme';
import type { ThemePreference } from '@/store/theme';

export type SettingsScreenStatus = 'ready';

export type SettingsFeedbackTone = 'success' | 'error';

export type SettingsFeedback = {
  tone: SettingsFeedbackTone;
  titleKey: TranslationKey;
  messageKey: TranslationKey;
};

export type UseSettingsScreenResult = {
  status: SettingsScreenStatus;
  loading: boolean;
  refreshing: boolean;
  initialized: boolean;
  saving: boolean;
  error: null;
  feedback: SettingsFeedback | null;
  themeMode: ThemePreference;
  language: string;
  languageSheetVisible: boolean;
  openLanguageSheet: () => void;
  closeLanguageSheet: () => void;
  setTheme: (mode: ThemePreference) => Promise<void>;
  setLanguage: (language: string) => Promise<void>;
};

export function useSettingsScreen(): UseSettingsScreenResult {
  const themeMode = useThemeStore(selectThemeMode);
  const language = useSettingsStore(selectLanguage);

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<SettingsFeedback | null>(null);
  const [languageSheetVisible, setLanguageSheetVisible] = useState(false);

  const mountedRef = useRef(true);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutationSerialRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  const showFeedback = useCallback((next: SettingsFeedback) => {
    if (!mountedRef.current) {
      return;
    }
    setFeedback(next);
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = setTimeout(() => {
      if (mountedRef.current) {
        setFeedback(null);
      }
    }, timeouts.toast);
  }, []);

  const runPreferenceMutation = useCallback(
    async (mutate: () => Promise<void>) => {
      const task = mutationSerialRef.current.then(async () => {
        if (mountedRef.current) {
          setSaving(true);
        }
        try {
          await mutate();
          showFeedback({
            tone: 'success',
            titleKey: 'settings.successTitle',
            messageKey: 'settings.successMessage',
          });
        } catch {
          showFeedback({
            tone: 'error',
            titleKey: 'settings.preferenceErrorTitle',
            messageKey: 'errors.unexpected',
          });
        } finally {
          if (mountedRef.current) {
            setSaving(false);
          }
        }
      });

      mutationSerialRef.current = task.catch(() => undefined);
      await task;
    },
    [showFeedback],
  );

  const setTheme = useCallback(
    async (mode: ThemePreference) => {
      if (useThemeStore.getState().themeMode === mode) {
        return;
      }
      await runPreferenceMutation(() => updateThemePreference(mode));
    },
    [runPreferenceMutation],
  );

  const setLanguage = useCallback(
    async (nextLanguage: string) => {
      const currentLocal = useSettingsStore.getState().language;
      if (currentLocal.toLowerCase() === nextLanguage.toLowerCase()) {
        setLanguageSheetVisible(false);
        return;
      }
      setLanguageSheetVisible(false);
      await runPreferenceMutation(() => updateLanguagePreference(nextLanguage));
    },
    [runPreferenceMutation],
  );

  const openLanguageSheet = useCallback(() => {
    setLanguageSheetVisible(true);
  }, []);

  const closeLanguageSheet = useCallback(() => {
    setLanguageSheetVisible(false);
  }, []);

  return {
    status: 'ready',
    loading: false,
    refreshing: false,
    initialized: true,
    saving,
    error: null,
    feedback,
    themeMode,
    language,
    languageSheetVisible,
    openLanguageSheet,
    closeLanguageSheet,
    setTheme,
    setLanguage,
  };
}
