import { useCallback, useSyncExternalStore } from 'react';

import type { BrowserEngineContextValue } from '@/browser/engine';
import { useBrowserStore } from '@/browser/stores';
import {
  createNoopTabController,
  tabControllerRegistry,
  type TabWebViewController,
} from '@/browser/tabs/tab-controller-registry';

// One stable placeholder per tab until its mounted controller registers (useSyncExternalStore needs a stable snapshot).
const noopControllers = new Map<string, TabWebViewController>();

function noopControllerFor(tabId: string): TabWebViewController {
  let controller = noopControllers.get(tabId);
  if (!controller) {
    if (noopControllers.size >= 16) {
      noopControllers.clear();
    }
    controller = createNoopTabController(tabId);
    noopControllers.set(tabId, controller);
  }
  return controller;
}

/**
 * Chrome facade — always forwards to the active tab's mounted controller.
 *
 * The controller itself is the external-store snapshot, so a controller registered after this screen first
 * rendered (cold start, session restore, remount) always replaces the placeholder. Caching the lookup on the
 * tab id alone kept the placeholder — and its never-incremented navigation epoch — for the whole session.
 */
export function useBrowserEngine(): BrowserEngineContextValue {
  const activeTabId = useBrowserStore((state) => state.activeTabId);
  const getController = useCallback(
    () => tabControllerRegistry.getActive(activeTabId) ?? noopControllerFor(activeTabId),
    [activeTabId],
  );
  return useSyncExternalStore(tabControllerRegistry.subscribe, getController, getController);
}
