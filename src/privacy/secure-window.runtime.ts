/**
 * P11 #689 — the app's one secure-window arbiter, bound to the browser module's existing `setWindowSecure` (B11 #106,
 * `SecureWindow.kt`). Incognito and the Private Folder both go through it, so neither clears the flag under the other.
 */

import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';

import { createSecureWindowArbiter, type SecureWindowOwner } from './secure-window';

const arbiter = createSecureWindowArbiter((secure) => {
  const web = isVidoraWebAvailable() ? getVidoraWeb() : null;
  void web
    ?.setWindowSecure?.(secure)
    .catch(() => false);
});

/** `owner` wants the window secure (no screenshots, no screen recording) or no longer does. */
export function holdSecureWindow(owner: SecureWindowOwner, secure: boolean): void {
  arbiter.hold(owner, secure);
}

export function isSecureWindowHeld(): boolean {
  return arbiter.isSecure();
}
