import { useCallback, useRef, useState } from 'react';

import {
  isPlayStoreListingConfigured,
  isUpdateCheckAvailable,
} from '@/constants/app-identity';
import { openPlayStoreListing } from '@/utils/open-play-store-listing';

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
 * No Expo Updates / version API: both actions open the VidoraX Play listing (Play Store app, else the web page),
 * where Play itself shows whether an update is available.
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
    if (!isUpdateCheckAvailable()) {
      setUpdateStatus('unavailable');
      return;
    }

    checkingRef.current = true;
    setUpdateStatus('checking');

    try {
      const opened = await openPlayStoreListing();
      setUpdateStatus(opened === 'failed' ? 'failed' : 'opened_store');
    } catch {
      setUpdateStatus('failed');
    } finally {
      checkingRef.current = false;
    }
  }, []);

  const rateApp = useCallback(async () => {
    if (!isPlayStoreListingConfigured()) {
      return false;
    }
    return (await openPlayStoreListing()) !== 'failed';
  }, []);

  return {
    updateStatus,
    updateCheckEnabled,
    rateEnabled,
    checkForUpdates,
    rateApp,
  };
}
