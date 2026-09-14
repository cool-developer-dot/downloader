import { useCallback, useRef, useState } from 'react';

import {
  appStoreConfig,
  isPlayStoreListingConfigured,
  isUpdateCheckAvailable,
} from '@/constants/app-identity';
import { openExternalUrl } from '@/utils/open-external-url';

/**
 * Truthful About update-check states.
 * Never invent version outcomes without real detection infrastructure.
 */
export type AboutUpdateStatus =
  | 'idle'
  | 'checking'
  | 'opened_store'
  | 'unavailable'
  | 'failed';

export type UseAboutStoreActionsResult = {
  updateStatus: AboutUpdateStatus;
  updateCheckEnabled: boolean;
  rateEnabled: boolean;
  checkForUpdates: () => Promise<void>;
  rateApp: () => Promise<boolean>;
};

/**
 * Store listing actions for About.
 * Phase 3A: no Expo Updates / version API — Play Store listing only when configured.
 */
export function useAboutStoreActions(): UseAboutStoreActionsResult {
  const [updateStatus, setUpdateStatus] = useState<AboutUpdateStatus>(() =>
    isUpdateCheckAvailable() ? 'idle' : 'unavailable',
  );
  const checkingRef = useRef(false);

  const updateCheckEnabled = isUpdateCheckAvailable();
  const rateEnabled = isPlayStoreListingConfigured();

  const checkForUpdates = useCallback(async () => {
    if (checkingRef.current) {
      return;
    }
    if (!isUpdateCheckAvailable() || !appStoreConfig.playStoreListingUrl) {
      setUpdateStatus('unavailable');
      return;
    }

    checkingRef.current = true;
    setUpdateStatus('checking');

    try {
      const opened = await openExternalUrl(appStoreConfig.playStoreListingUrl);
      setUpdateStatus(opened ? 'opened_store' : 'failed');
    } catch {
      setUpdateStatus('failed');
    } finally {
      checkingRef.current = false;
    }
  }, []);

  const rateApp = useCallback(async () => {
    const url = appStoreConfig.playStoreListingUrl;
    if (!url || !isPlayStoreListingConfigured()) {
      return false;
    }
    return openExternalUrl(url);
  }, []);

  return {
    updateStatus,
    updateCheckEnabled,
    rateEnabled,
    checkForUpdates,
    rateApp,
  };
}
