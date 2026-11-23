import { memo, useEffect } from 'react';
import { AppState } from 'react-native';

import { useQualitySelectionContext } from '@/screens/downloads/quality';
import { useAppLockStore } from '@/security/app-lock/app-lock.store';

import { hasStreamDownloadRequest, subscribeStreamDownloadRequests, takeStreamDownloadRequest } from './stream-download-handoff';

/** The Player leaves for the Downloads tab first: run once its screen has had a moment to close. */
const SETTLE_DELAY_MS = 450;

/**
 * P14 #672: runs "Download this stream" with the downloader's own link flow (`openWithUrl`: check the link, then the
 * quality sheet) once the tabs are in front and VidoraX is unlocked. Renders nothing; mounted in the tabs layout,
 * inside the quality selection provider, next to the Paste link request handler.
 */
export const StreamDownloadHandoff = memo(function StreamDownloadHandoff() {
  const { openWithUrl } = useQualitySelectionContext();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      if (timer) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        if (AppState.currentState !== 'active' || useAppLockStore.getState().status === 'LOCKED') {
          return;
        }
        const request = takeStreamDownloadRequest();
        if (request) {
          void openWithUrl(request.url, { referer: request.referer });
        }
      }, SETTLE_DELAY_MS);
    };
    if (hasStreamDownloadRequest()) {
      run();
    }
    const unsubscribe = subscribeStreamDownloadRequests(run);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active' && hasStreamDownloadRequest()) {
        run();
      }
    });
    const unsubscribeLock = useAppLockStore.subscribe((state, previous) => {
      if (previous.status === 'LOCKED' && state.status !== 'LOCKED' && hasStreamDownloadRequest()) {
        run();
      }
    });
    return () => {
      unsubscribe();
      unsubscribeLock();
      appState.remove();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [openWithUrl]);

  return null;
});
