import { browserMediaActionService } from '@/browser/media-actions/browser-media-action.service';
import { bindDesktopModeSnapshotReader } from '@/browser/session/desktop-mode-snapshot';
import { createStore } from '@/store/shared/create-store';

import { createBrowserActions } from './actions';
import { initialBrowserState } from './state';
import type { BrowserStore } from './types';

export const useBrowserStore = createStore<BrowserStore>((set, get) => ({
  ...initialBrowserState,
  ...createBrowserActions(set, get),
}));

browserMediaActionService.setActiveTab(initialBrowserState.activeTabId);

bindDesktopModeSnapshotReader(() => {
  const state = useBrowserStore.getState();
  return {
    desktopMode: Boolean(state.desktopMode),
    tabs: state.tabs.map((tab) => ({
      id: tab.id,
      desktopMode: Boolean(tab.desktopMode),
    })),
  };
});

export * from './selectors';
export { initialBrowserState, initialBrowserSessionState } from './state';
export type { BrowserActions, BrowserStore } from './types';
