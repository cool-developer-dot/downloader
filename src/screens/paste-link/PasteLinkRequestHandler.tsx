import { memo, useEffect } from 'react';
import { AppState } from 'react-native';

import { stepAsideForPasteLink } from '@/browser/services/clipboard-link-monitor';
import {
  hasPasteLinkRequest,
  subscribePasteLinkRequests,
  takePasteLinkRequest,
} from '@/browser/services/paste-link-request';
import { useQualitySelectionContext } from '@/screens/downloads/quality';
import { useAppLockStore } from '@/security/app-lock/app-lock.store';

/** Android lets only the focused app read the clipboard: give the window a moment to take focus first. */
const FOCUS_DELAY_MS = 400;

/**
 * Runs a "Paste link" request from the app shortcut or the widget (`paste-link-request.ts`) with the Paste link
 * button's own action, once VidoraX is in front and unlocked (with App Lock on, after the PIN — never under the lock
 * screen, where the request would be used up with nothing to show). The Clipboard Monitor steps aside for it, so its banner never offers
 * the same link a second time. Renders nothing; mounted inside the tabs, next to that action.
 */
export const PasteLinkRequestHandler = memo(function PasteLinkRequestHandler() {
  const { open } = useQualitySelectionContext();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      if (timer) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        // Not in front, or still behind App Lock: the next return to the foreground, or the unlock, runs it.
        if (AppState.currentState !== 'active' || useAppLockStore.getState().status === 'LOCKED' || !takePasteLinkRequest()) {
          return;
        }
        stepAsideForPasteLink();
        open();
      }, FOCUS_DELAY_MS);
    };
    if (hasPasteLinkRequest()) {
      run();
    }
    const unsubscribe = subscribePasteLinkRequests(run);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active' && hasPasteLinkRequest()) {
        run();
      }
    });
    const unsubscribeLock = useAppLockStore.subscribe((state, previous) => {
      if (previous.status === 'LOCKED' && state.status !== 'LOCKED' && hasPasteLinkRequest()) {
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
  }, [open]);

  return null;
});
