import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';

import { BROWSER_HOMEPAGE } from '@/browser/constants';
import { requestAddressBarFocus } from '@/browser/services/address-bar-focus';
import { announceTabsLimitReached } from '@/browser/services/tabs-limit-notice';
import { useBrowserStore } from '@/browser/stores';
import { navigation, routePaths } from '@/navigation';
import { useAppLockStore } from '@/security/app-lock/app-lock.store';

/**
 * B24 #65 — the home-screen search widget: once App Lock is open (or off), a new tab on the start page with the
 * address bar focused, on the Browser tab (as B9's bookmark shortcuts open their site).
 */

function openSearchTab(): void {
  const open = () => {
    const result = useBrowserStore.getState().createTab({ url: BROWSER_HOMEPAGE });
    if (result.status === 'LIMIT_REACHED') {
      announceTabsLimitReached();
      return;
    }
    try {
      navigation.navigate(routePaths.browser);
    } catch {
      // The browser is the start screen anyway.
    }
    requestAddressBarFocus();
  };
  const ready = () => {
    const lock = useAppLockStore.getState();
    return lock.isBootstrapped && lock.status !== 'LOCKED';
  };
  if (ready()) {
    open();
    return;
  }
  const unsubscribe = useAppLockStore.subscribe(() => {
    if (!ready()) return;
    unsubscribe();
    open();
  });
}

let attached = false;

/** Idempotent; app start: a widget tap that started the app, and those while it runs. */
export function ensureSearchWidgetHandling(): void {
  if (attached || !isVidoraWebAvailable()) return;
  attached = true;
  const web = getVidoraWeb();
  try {
    if (web.consumeSearchWidgetTap?.()) openSearchTab();
  } catch {
    // Older native build.
  }
  try {
    web.addListener('onSearchWidget', () => openSearchTab());
  } catch {
    // Older native build.
  }
}

/** B24 #271: whether an Urdu keyboard is on (null when unknown: an older native build). */
export function hasUrduKeyboard(): boolean | null {
  if (!isVidoraWebAvailable()) return null;
  const fn = getVidoraWeb().hasUrduKeyboard;
  if (!fn) return null;
  try {
    return fn();
  } catch {
    return null;
  }
}

export function openKeyboardSettings(): boolean {
  if (!isVidoraWebAvailable()) return false;
  try {
    return getVidoraWeb().openKeyboardSettings?.() === true;
  } catch {
    return false;
  }
}
