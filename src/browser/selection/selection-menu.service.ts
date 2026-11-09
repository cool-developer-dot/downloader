import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { getVidoraWeb, isVidoraWebAvailable, type SelectionActionEvent } from '@modules/vidorax-web';
import { getSearchEngine } from '@/browser/search/search-engines';
import { announceTabsLimitReached } from '@/browser/services/tabs-limit-notice';
import { useBrowserStore } from '@/browser/stores';
import { translate } from '@/localization';

import { handleSelectionAction } from './selection-actions';
import { buildSelectionMenu, SELECTION_MENU_ITEMS } from './selection-menu-items';
import { SELECTION_READ_SCRIPT } from './selection-read-script';
import { saveNote } from '@/browser/notes/notes.service';
import { tabIdForViewTag } from '@/browser/webview/webview-view-tags';

/**
 * B8 #72–#74 — the app's items in a page's text-selection menu. `start()` gives VidoraWeb the translated items and
 * listens for taps; `stop()` takes them away again (the menu is then exactly Android's / Chromium's). Called again when
 * the app language changes.
 */

let subscription: { remove(): void } | null = null;

function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

function onSelectionAction(event: SelectionActionEvent): void {
  handleSelectionAction(event, {
    buildSearchUrl: (query) => getSearchEngine().buildSearchUrl(query),
    openTabAfterCurrent: (url, title) => {
      const store = useBrowserStore.getState();
      // Inserted right after the tab in front (B6's background-tab plan), then shown.
      const outcome = store.openTabInBackground(url, { title });
      if (outcome.status !== 'CREATED') {
        announceTabsLimitReached();
        return false;
      }
      useBrowserStore.getState().switchTab(outcome.tabId);
      return true;
    },
    notifyTruncated: () => notify(translate('browserSelection.searchTruncated')),
    // B22 #252: the selected text with its page, from the tab the menu was on.
    saveNote: (text, viewTag) => void saveNote(text, tabIdForViewTag(viewTag)),
  });
}

export const selectionMenuService = {
  start(): void {
    if (!isVidoraWebAvailable()) return;
    try {
      const native = getVidoraWeb();
      if (!native.setSelectionMenu) return; // older native build: the menu stays as it was
      const { ids, titles } = buildSelectionMenu(SELECTION_MENU_ITEMS, (key) => translate(key));
      native.setSelectionMenu(ids, titles, SELECTION_READ_SCRIPT);
      if (!subscription) subscription = native.addListener('onSelectionAction', onSelectionAction);
    } catch {
      // ignore: the page's own menu keeps working
    }
  },

  stop(): void {
    subscription?.remove();
    subscription = null;
    if (!isVidoraWebAvailable()) return;
    try {
      getVidoraWeb().setSelectionMenu?.([], [], '');
    } catch {
      // ignore
    }
  },
};
