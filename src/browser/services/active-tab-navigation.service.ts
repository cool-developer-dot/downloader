/**
 * Canonical active-tab navigation commands.
 * Toolbar + Android hardware Back must share this owner — never fork competing logic.
 *
 * Every command captures targetTabId at call time and resolves the controller from
 * tabControllerRegistry. Commands never retarget a newly activated tab mid-flight.
 */
import { BROWSER_HOMEPAGE } from '@/browser/constants';
import { logBrowserNav } from '@/browser/diagnostics';
import { browserSyncService } from '@/browser/services/browser-sync.service';
import { useBrowserStore } from '@/browser/stores';
import { tabControllerRegistry } from '@/browser/tabs/tab-controller-registry';
import { isBrowserHomeUrl } from '@/browser/utils';

/**
 * Chrome-only Home reset for a tab whose WebView controller is not mounted
 * (evicted, mid-remount, or unregistered).
 *
 * Without this, Back / Home silently no-op whenever the controller lookup
 * fails, and the only way out of the stuck page was opening a new tab.
 */
function recoverTabToHome(targetTabId: string): boolean {
  const store = useBrowserStore.getState();
  const tab = store.tabs.find((t) => t.id === targetTabId);
  if (!tab || isBrowserHomeUrl(tab.url)) {
    return false;
  }

  logBrowserNav(tab.navigationEpoch, 'home', {
    strategy: 'chrome_recovery',
    decisionReason: 'controller_unavailable',
    tabId: targetTabId,
  });

  store.updateTab(targetTabId, {
    url: BROWSER_HOMEPAGE,
    title: 'Home',
    loading: false,
    progress: 0,
    canGoBack: false,
    canGoForward: false,
    error: null,
  });
  if (useBrowserStore.getState().activeTabId === targetTabId) {
    useBrowserStore.getState().syncChromeFromActiveTab();
    // Home means Home for continuity too — the session must not restore the
    // page the user just escaped from.
    browserSyncService.onGoHome();
  }
  return true;
}

function resolveLiveController(targetTabId: string) {
  const controller = tabControllerRegistry.get(targetTabId);
  if (!controller || controller.tabId !== targetTabId) {
    return null;
  }
  // Evicted / unregistered bump generation; reject zero/stale mounts.
  if (controller.webViewInstanceGenerationRef.current <= 0) {
    return null;
  }
  return controller;
}

/** Back for a captured tab — native WebView history, else Home when on a website. */
export function goBackForTab(targetTabId: string): boolean {
  const controller = resolveLiveController(targetTabId);
  if (!controller) {
    // No mounted WebView for this tab — never swallow Back silently.
    return recoverTabToHome(targetTabId);
  }

  const gen = controller.webViewInstanceGenerationRef.current;
  const tab = useBrowserStore.getState().tabs.find((t) => t.id === targetTabId);
  if (!tab || isBrowserHomeUrl(tab.url)) {
    return false;
  }

  logBrowserNav(controller.navigationEpochRef.current, 'back', {
    strategy: 'active_tab_command',
    tabId: targetTabId,
    canGoBack: controller.nativeCanGoBackRef.current,
  });

  controller.goBack();

  // Ignore if controller was replaced during the sync call (close/evict).
  const still = tabControllerRegistry.get(targetTabId);
  return Boolean(
    still &&
      still.webViewInstanceGenerationRef.current === gen &&
      still.tabId === targetTabId,
  );
}

/** Forward for a captured tab — native history only; no-op when unavailable. */
export function goForwardForTab(targetTabId: string): boolean {
  const controller = resolveLiveController(targetTabId);
  if (!controller) {
    return false;
  }
  if (!controller.nativeCanGoForwardRef.current) {
    const tab = useBrowserStore.getState().tabs.find((t) => t.id === targetTabId);
    if (!tab?.canGoForward) {
      return false;
    }
  }

  const gen = controller.webViewInstanceGenerationRef.current;
  logBrowserNav(controller.navigationEpochRef.current, 'forward', {
    strategy: 'active_tab_command',
    tabId: targetTabId,
    canGoForward: true,
  });
  controller.goForward();

  const still = tabControllerRegistry.get(targetTabId);
  return Boolean(
    still &&
      still.webViewInstanceGenerationRef.current === gen &&
      still.tabId === targetTabId,
  );
}

/** Home for a captured tab — same tab only; never creates a new tab. */
export function goHomeForTab(targetTabId: string): boolean {
  const controller = resolveLiveController(targetTabId);
  if (!controller) {
    return recoverTabToHome(targetTabId);
  }

  const tab = useBrowserStore.getState().tabs.find((t) => t.id === targetTabId);
  if (!tab || isBrowserHomeUrl(tab.url)) {
    return false;
  }

  const gen = controller.webViewInstanceGenerationRef.current;
  logBrowserNav(controller.navigationEpochRef.current, 'home', {
    strategy: 'active_tab_command',
    tabId: targetTabId,
  });
  controller.goHome();

  const still = tabControllerRegistry.get(targetTabId);
  return Boolean(
    still &&
      still.webViewInstanceGenerationRef.current === gen &&
      still.tabId === targetTabId,
  );
}

export function reloadForTab(targetTabId: string): boolean {
  const controller = resolveLiveController(targetTabId);
  if (!controller) {
    return false;
  }
  const tab = useBrowserStore.getState().tabs.find((t) => t.id === targetTabId);
  if (!tab || isBrowserHomeUrl(tab.url)) {
    return false;
  }
  controller.reload();
  return true;
}

export function stopLoadingForTab(targetTabId: string): boolean {
  const controller = resolveLiveController(targetTabId);
  if (!controller) {
    return false;
  }
  controller.stopLoading();
  return true;
}

/**
 * Omnibox / home-shortcut / chrome load into a captured tab.
 * Resolves the mounted controller at call time — never the chrome noop facade.
 * Same owner as Back/Forward/Home so shortcuts and typed Enter cannot diverge.
 */
export function loadUrlForTab(targetTabId: string, url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }

  // Prefer registry presence (same as home shortcuts). Generation may be mid-remount;
  // loadUrl itself is idempotent chrome navigation and must not silently no-op.
  const controller = tabControllerRegistry.get(targetTabId);
  if (!controller || controller.tabId !== targetTabId) {
    return false;
  }

  logBrowserNav(controller.navigationEpochRef.current, 'request', {
    strategy: 'active_tab_command',
    decisionReason: 'chrome_load_url',
    tabId: targetTabId,
  });
  controller.loadUrl(trimmed);
  return true;
}

/** Capture activeTabId then Back — shared by toolbar + hardware Back. */
export function goBackActiveTab(): boolean {
  return goBackForTab(useBrowserStore.getState().activeTabId);
}

export function loadUrlActiveTab(url: string): boolean {
  return loadUrlForTab(useBrowserStore.getState().activeTabId, url);
}

export function goForwardActiveTab(): boolean {
  return goForwardForTab(useBrowserStore.getState().activeTabId);
}

export function goHomeActiveTab(): boolean {
  return goHomeForTab(useBrowserStore.getState().activeTabId);
}

export function reloadActiveTab(): boolean {
  return reloadForTab(useBrowserStore.getState().activeTabId);
}

export function stopLoadingActiveTab(): boolean {
  return stopLoadingForTab(useBrowserStore.getState().activeTabId);
}
