import { useMemo, useSyncExternalStore } from 'react';

import type { BrowserEngineContextValue } from '@/browser/engine';
import { useBrowserStore } from '@/browser/stores';
import {
  createNoopTabController,
  tabControllerRegistry,
} from '@/browser/tabs/tab-controller-registry';

/**
 * Chrome facade — always forwards to the active tab's mounted controller.
 */
export function useBrowserEngine(): BrowserEngineContextValue {
  const activeTabId = useBrowserStore((state) => state.activeTabId);
  const version = useSyncExternalStore(
    tabControllerRegistry.subscribe,
    tabControllerRegistry.getVersion,
    tabControllerRegistry.getVersion,
  );

  return useMemo(() => {
    void version;
    return (
      tabControllerRegistry.getActive(activeTabId) ?? createNoopTabController(activeTabId)
    );
  }, [activeTabId, version]);
}
