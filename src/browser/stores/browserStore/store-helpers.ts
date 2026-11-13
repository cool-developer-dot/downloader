import { scrollPositionService } from '@/browser/scroll';
import { browserMediaActionService } from '@/browser/media-actions/browser-media-action.service';
import { clearIntentLoopGuardForTab } from '@/browser/navigation/intent-loop-guard';
import { persistTabEngineState, type BrowserTab } from '@/browser/tabs';
import { getSecurityLevel, isSecureUrl } from '@/browser/utils';
import { socialPageContextStore } from '@/media-detection/social';
import { generalPageMediaContextStore } from '@/media-detection/general-media';
import { clearSocialSourceRefreshAttempts } from '@/media-detection/social-source/social-source-provider';
import { mediaDetectionEngine } from '@/media-detection/engine';
import { clearVerificationForTab } from '@/media-detection/social-source/verification-session';

import type { BrowserStore } from './types';

/**
 * Helpers shared by the tab engine actions (actions.ts) and B1's tab management (tab-management-actions.ts).
 */

type SecurityFields = {
  isSecure: boolean;
  securityLevel: ReturnType<typeof getSecurityLevel>;
};

/**
 * Security fields are two `new URL()` parses, and chromeFromTab recomputed them
 * on every progress tick (~20/s while a page loads). The active tab's URL is
 * constant across all of those ticks, so memoize per URL. Bounded well above
 * MAX_OPEN_TABS — this only ever holds tab URLs.
 */
const SECURITY_FIELDS_CACHE_MAX = 16;
const securityFieldsCache = new Map<string, SecurityFields>();

export function securityFields(url: string): SecurityFields {
  const cached = securityFieldsCache.get(url);
  if (cached) {
    return cached;
  }
  const fields: SecurityFields = {
    isSecure: isSecureUrl(url),
    securityLevel: getSecurityLevel(url),
  };
  if (securityFieldsCache.size >= SECURITY_FIELDS_CACHE_MAX) {
    const oldest = securityFieldsCache.keys().next().value;
    if (oldest !== undefined) {
      securityFieldsCache.delete(oldest);
    }
  }
  securityFieldsCache.set(url, fields);
  return fields;
}

export function persistTabs(state: Pick<BrowserStore, 'tabs' | 'activeTabId'>): void {
  persistTabEngineState({ tabs: state.tabs, activeTabId: state.activeTabId });
}

export function chromeFromTab(tab: BrowserTab) {
  return {
    currentUrl: tab.url,
    pageTitle: tab.title,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
    isLoading: tab.loading,
    progress: tab.progress,
    error: tab.error,
    desktopMode: tab.desktopMode,
    desktopModeUserExplicit: tab.desktopModeSource === 'user',
    ...securityFields(tab.url),
  };
}

/**
 * A tab whose WebView is being unmounted (mount-pool eviction / blur budget).
 * The tab itself survives, so page context is kept — only work that would
 * outlive the WebView is cancelled: in-flight media verification and the
 * pending scroll-restore inject for a view that is about to disappear.
 */
export function suspendUnmountedTabs(tabIds: readonly string[]): void {
  for (const tabId of tabIds) {
    try {
      browserMediaActionService.suspendTab(tabId);
    } catch {
      // CTA seam may not be ready in early boot
    }
    try {
      scrollPositionService.cancelRestore(tabId);
    } catch {
      // Scroll seam optional during early boot
    }
  }
}

export function cleanupClosedTab(tabId: string): void {
  try {
    browserMediaActionService.clearTab(tabId);
  } catch {
    // CTA seam may not be ready in early boot
  }
  try {
    clearIntentLoopGuardForTab(tabId);
  } catch {
    // Intent seam optional during early boot
  }
  try {
    // Phase 4A — drop ephemeral social correlation state for closed tab.
    socialPageContextStore.clearTab(tabId);
  } catch {
    // Social correlation optional during early boot
  }
  try {
    // Phase 5A — drop ephemeral general media ownership state for closed tab.
    generalPageMediaContextStore.clearTab(tabId);
  } catch {
    // General media optional during early boot
  }
  try {
    mediaDetectionEngine.clearTab(tabId);
  } catch {
    // Detection engine optional during early boot
  }
  try {
    // Phase 4B — drop verification cache / refresh budget for closed tab.
    clearVerificationForTab(tabId);
    clearSocialSourceRefreshAttempts(tabId);
  } catch {
    // Social source optional during early boot
  }
}
