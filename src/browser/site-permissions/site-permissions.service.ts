import { resolvePopupNavigation } from '@/browser/navigation/popup-navigation.service';
import { siteKey } from '@/browser/privacy/privacy-settings';
import { isIncognitoTabId } from '@/browser/incognito/incognito-state';
import { loadUrlForTab } from '@/browser/services/active-tab-navigation.service';
import { useBrowserStore } from '@/browser/stores';
import { useSettingsStore } from '@/store/settings';

import {
  parseSitePermissions,
  popupsAllowedFor,
  recordBlocked,
  resetSite,
  serializeSitePermissions,
  setPopupsAllowed,
  type SitePermissionKind,
  type SitePermissions,
} from './site-permissions';

/**
 * B13 — what happens when a page asks for something (`site_permission`) or tries to open a pop-up (`popup_blocked`),
 * and the edits the Site permissions sheet makes. The site list lives in the `sitePermissions` setting (per profile).
 * The short bar that tells the user is `siteNotice` below.
 */

export type SiteNotice =
  | { kind: 'permission'; site: string; permission: SitePermissionKind; shownAt: number }
  | { kind: 'popup'; site: string; tabId: string; url: string | null; shownAt: number };

type Listener = () => void;

let notice: SiteNotice | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

export const siteNotice = {
  get(): SiteNotice | null {
    return notice;
  },
  show(next: SiteNotice): void {
    notice = next;
    emit();
  },
  dismiss(shownAt?: number): void {
    if (!notice || (shownAt != null && notice.shownAt !== shownAt)) return;
    notice = null;
    emit();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

function read(): SitePermissions {
  return parseSitePermissions(useSettingsStore.getState().sitePermissions);
}

function write(next: SitePermissions): void {
  useSettingsStore.getState().updateSetting('sitePermissions', serializeSitePermissions(next));
}

function tabUrl(tabId: string | null): string {
  const state = useBrowserStore.getState();
  const id = tabId ?? state.activeTabId;
  return state.tabs.find((tab) => tab.id === id)?.url ?? '';
}

/** A page asked for `kind`: it was refused in the page; list it as Blocked and tell the user (page in front only). */
export function onSitePermissionRequest(kind: SitePermissionKind, fromTabId: string | null, isActive: boolean): void {
  const site = siteKey(tabUrl(fromTabId));
  if (!site) return;
  // B11: refused the same way, but an incognito tab's site is not added to the list.
  if (!isIncognitoTabId(fromTabId ?? useBrowserStore.getState().activeTabId)) {
    write(recordBlocked(read(), site, kind, Date.now()));
  }
  if (isActive) siteNotice.show({ kind: 'permission', site, permission: kind, shownAt: Date.now() });
}

/** Loads a pop-up's address the way the app handles any new window (in the tab it came from). */
function openPopup(tabId: string, url: string): void {
  const decision = resolvePopupNavigation(url);
  if (decision.action === 'load_in_browser') loadUrlForTab(tabId, decision.url);
}

/** A page tried to open a window without a tap. Sites the user allowed get it; others get the "Pop-up blocked" bar. */
export function onPopupBlocked(url: string | null, fromTabId: string | null, isActive: boolean): void {
  const tabId = fromTabId ?? useBrowserStore.getState().activeTabId;
  const site = siteKey(tabUrl(tabId));
  if (!site) return;
  if (popupsAllowedFor(read(), site)) {
    if (url) openPopup(tabId, url);
    return;
  }
  if (isActive) siteNotice.show({ kind: 'popup', site, tabId, url, shownAt: Date.now() });
}

export const sitePermissionActions = {
  allowPopupOnce(n: Extract<SiteNotice, { kind: 'popup' }>): void {
    siteNotice.dismiss(n.shownAt);
    if (n.url) openPopup(n.tabId, n.url);
  },
  allowPopupsAlways(n: Extract<SiteNotice, { kind: 'popup' }>): void {
    write(setPopupsAllowed(read(), n.site, true, Date.now()));
    sitePermissionActions.allowPopupOnce(n);
  },
  setPopupsAllowed(site: string, allowed: boolean): void {
    write(setPopupsAllowed(read(), site, allowed, Date.now()));
  },
  resetSite(site: string): void {
    write(resetSite(read(), site));
  },
  resetAll(): void {
    write({});
  },
};

/** B13 #116 from the lock icon: which site the Site permissions sheet shows (null = closed; '' = every site). */
let sheetSite: string | null = null;
const sheetListeners = new Set<Listener>();

export const sitePermissionsSheet = {
  get(): string | null {
    return sheetSite;
  },
  open(site: string | null): void {
    sheetSite = site ?? '';
    for (const listener of sheetListeners) listener();
  },
  close(): void {
    sheetSite = null;
    for (const listener of sheetListeners) listener();
  },
  subscribe(listener: Listener): () => void {
    sheetListeners.add(listener);
    return () => {
      sheetListeners.delete(listener);
    };
  },
};
