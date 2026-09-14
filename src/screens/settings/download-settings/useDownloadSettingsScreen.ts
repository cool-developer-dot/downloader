import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import {
  deriveEffectiveNotificationsState,
  getDownloadNotificationService,
  type EffectiveNotificationsState,
} from '@/downloads/notifications';
import {
  getDownloadSettings,
  hydrateDownloadSettings,
  normalizeMaxConcurrentDownloads,
  updateDownloadSettings,
  type DownloadSettings,
} from '@/downloads/settings';
import {
  updateAutoResumePreference,
  updateNotificationsPreference,
  updateWifiOnlyPreference,
} from '@/services/auth/settings.service';
import {
  selectAutoResume,
  selectMaxConcurrentDownloads,
  selectNotifications,
  selectWifiOnly,
  useSettingsStore,
} from '@/store/settings';

import { translate } from '@/localization';

import { mapSettingsError } from '../utils';

export type DownloadSettingsFeedback = {
  tone: 'success' | 'pending' | 'error';
  title: string;
  message: string;
};

export type UseDownloadSettingsScreenResult = {
  settings: DownloadSettings;
  hydrated: boolean;
  saving: boolean;
  feedback: DownloadSettingsFeedback | null;
  notificationEffective: EffectiveNotificationsState | null;
  setWifiOnly: (value: boolean) => Promise<void>;
  setAutoResume: (value: boolean) => Promise<void>;
  setMaxConcurrent: (value: number) => Promise<void>;
  setNotifications: (value: boolean) => Promise<void>;
  openNotificationSettings: () => Promise<void>;
};

function fallbackNotificationState(
  preferenceEnabled: boolean,
): EffectiveNotificationsState {
  return deriveEffectiveNotificationsState({
    preferenceEnabled,
    permissionStatus: 'unavailable',
    canAskAgain: true,
  });
}

/**
 * Download Settings controller.
 * Wi-Fi / Auto Resume / Notifications keep Week 6 server sync.
 * maxConcurrentDownloads is local-only policy for Day 2.
 * Notification OS permission is requested only on user toggle ON.
 *
 * Toggle UX: store updates optimistically inside preference helpers — UI never
 * waits on PATCH / MMKV before flipping the switch.
 */
export function useDownloadSettingsScreen(): UseDownloadSettingsScreenResult {
  const wifiOnly = useSettingsStore(selectWifiOnly);
  const autoResume = useSettingsStore(selectAutoResume);
  const notifications = useSettingsStore(selectNotifications);
  const maxConcurrentDownloads = useSettingsStore(selectMaxConcurrentDownloads);

  const [hydrated] = useState(() => {
    // Reconcile explicit disk keys into the store. Missing keys keep Zustand
    // (AsyncStorage on Expo Go) — does not force product defaults.
    hydrateDownloadSettings();
    return true;
  });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<DownloadSettingsFeedback | null>(null);
  const [notificationEffective, setNotificationEffective] =
    useState<EffectiveNotificationsState | null>(null);

  const mountedRef = useRef(true);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const settings = useMemo<DownloadSettings>(
    () => ({
      wifiOnly,
      autoResume,
      maxConcurrentDownloads,
      notificationsEnabled: notifications,
    }),
    [wifiOnly, autoResume, maxConcurrentDownloads, notifications],
  );

  const refreshNotificationPermission = useCallback(async () => {
    try {
      const state = await getDownloadNotificationService().refreshPermissionState();
      if (mountedRef.current) {
        setNotificationEffective(state);
      }
    } catch {
      if (!mountedRef.current) {
        return;
      }
      setNotificationEffective((previous) => {
        if (previous) {
          return previous;
        }
        return fallbackNotificationState(
          useSettingsStore.getState().notifications,
        );
      });
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refreshNotificationPermission();

    const subscription = AppState.addEventListener(
      'change',
      (status: AppStateStatus) => {
        if (status === 'active') {
          void refreshNotificationPermission();
        }
      },
    );

    return () => {
      mountedRef.current = false;
      subscription.remove();
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
    };
  }, [refreshNotificationPermission]);

  const showFeedback = useCallback((next: DownloadSettingsFeedback) => {
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
    }, 2800);
  }, []);

  /**
   * Preference toggles: invoke `mutate()` synchronously so
   * Zustand/MMKV apply before the first await.
   */
  const runLocalMutation = useCallback(
    (mutate: () => Promise<void>) => {
      if (mountedRef.current) {
        setSaving(true);
      }

      const pending = mutate();

      void pending
        .then(() => {
          if (!mountedRef.current) {
            return;
          }
          showFeedback({
            tone: 'success',
            title: translate('settings.successTitle'),
            message: translate('settings.downloadSettingsSuccessMessage'),
          });
        })
        .catch((caught: unknown) => {
          if (!mountedRef.current) {
            return;
          }
          const mapped = mapSettingsError(caught, 'save');
          showFeedback({
            tone: 'error',
            title: translate('settings.preferenceErrorTitle'),
            message: translate(mapped.messageKey),
          });
        })
        .finally(() => {
          if (mountedRef.current) {
            setSaving(false);
          }
        });
    },
    [showFeedback],
  );

  const setWifiOnly = useCallback(
    async (value: boolean) => {
      if (getDownloadSettings().wifiOnly === value) {
        return;
      }
      runLocalMutation(() => updateWifiOnlyPreference(value));
    },
    [runLocalMutation],
  );

  const setAutoResume = useCallback(
    async (value: boolean) => {
      if (getDownloadSettings().autoResume === value) {
        return;
      }
      runLocalMutation(() => updateAutoResumePreference(value));
    },
    [runLocalMutation],
  );

  const setNotifications = useCallback(
    async (value: boolean) => {
      if (getDownloadSettings().notificationsEnabled === value) {
        return;
      }
      runLocalMutation(async () => {
        const result = await updateNotificationsPreference(value);
        const service = getDownloadNotificationService();
        const state = value
          ? await service.enableFromUserGesture()
          : await service.refreshPermissionState();
        if (mountedRef.current) {
          setNotificationEffective(state);
        }
        return result;
      });
    },
    [runLocalMutation],
  );

  const setMaxConcurrent = useCallback(
    async (value: number) => {
      const next = normalizeMaxConcurrentDownloads(value);
      if (getDownloadSettings().maxConcurrentDownloads === next) {
        return;
      }
      updateDownloadSettings({ maxConcurrentDownloads: next });
      showFeedback({
        tone: 'success',
        title: translate('settings.successTitle'),
        message: translate('settings.downloadSettingsSuccessMessage'),
      });
    },
    [showFeedback],
  );

  const openNotificationSettings = useCallback(async () => {
    await getDownloadNotificationService().openSystemSettings();
  }, []);

  return {
    settings,
    hydrated,
    saving,
    feedback,
    notificationEffective,
    setWifiOnly,
    setAutoResume,
    setMaxConcurrent,
    setNotifications,
    openNotificationSettings,
  };
}
