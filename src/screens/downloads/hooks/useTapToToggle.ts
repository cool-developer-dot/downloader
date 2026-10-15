import { useCallback } from 'react';

import { isEngineOwned } from '@/downloads/v2';
import { resolveTapToggle } from '@/downloads/v2/tap-to-toggle';
import { useDownloadsStore } from '@/store/downloads';
import { selectTapToToggle, useSettingsStore } from '@/store/settings';

import { getSupportedActions } from '../utils/download-format';

/**
 * Tap to Toggle (#335). Returns a handler that pauses/resumes the tapped row when the setting is on and the row
 * offers that button, and reports whether it did; when it returns false the caller opens the details as before.
 */
export function useTapToToggle(handlers: { pause: (id: string) => void; resume: (id: string) => void }) {
  const enabled = useSettingsStore(selectTapToToggle);
  const { pause, resume } = handlers;

  return useCallback(
    (id: string): boolean => {
      if (!enabled) {
        return false;
      }
      const state = useDownloadsStore.getState();
      const item = state.itemsById[id];
      if (!item) {
        return false;
      }
      const transfer = state.transferById[id] ?? null;
      // The same actions the card renders for this row.
      const cardActions = getSupportedActions(item.status, item.sourceUrl, {
        localUri: transfer?.localUri ?? null,
        localState: transfer?.localState ?? null,
        executionState: transfer?.executionState ?? null,
        workerState: item.workerState ?? transfer?.workerState ?? null,
        supportsResume: transfer?.supportsResume ?? null,
        errorCode: item.errorCode ?? null,
      });
      const action = resolveTapToggle({
        enabled,
        engineOwned: isEngineOwned(state, id),
        status: item.status,
        cardActions,
      });
      if (action === 'pause') {
        pause(id);
        return true;
      }
      if (action === 'resume') {
        resume(id);
        return true;
      }
      return false;
    },
    [enabled, pause, resume],
  );
}
