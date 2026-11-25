/**
 * P11 #689 Block Screen Capture — who wants the window secure. Pure.
 *
 * Android's `FLAG_SECURE` (no screenshots, no screen recording, a blank recent-apps preview) is set on the app's one
 * window by the browser module's existing `setWindowSecure` (`modules/vidorax-web/.../security/SecureWindow.kt`, B11
 * #106). That native side keeps one owner: a "clear" from anyone clears it. So every part of the app that wants it
 * names itself here — incognito and the Private Folder today — and only the arbiter calls the native function: secure
 * while at least one holds it, cleared when the last lets go, and never called twice for the same state.
 */

export type SecureWindowOwner = 'incognito' | 'private-folder' | 'app' | (string & {});

export type SecureWindowArbiter = {
  /** `owner` wants the window secure (`true`) or no longer does (`false`). Repeating a call changes nothing. */
  hold: (owner: SecureWindowOwner, secure: boolean) => void;
  /** Whether the window is asked to be secure now. */
  isSecure: () => boolean;
  /** Who holds it (tests, diagnostics). */
  holders: () => SecureWindowOwner[];
};

/** `apply` is the native call; it runs only when the answer changes. */
export function createSecureWindowArbiter(apply: (secure: boolean) => void): SecureWindowArbiter {
  const owners = new Set<SecureWindowOwner>();
  let applied = false;
  return {
    hold: (owner, secure) => {
      if (!owner) {
        return;
      }
      if (secure) {
        owners.add(owner);
      } else {
        owners.delete(owner);
      }
      const next = owners.size > 0;
      if (next !== applied) {
        applied = next;
        try {
          apply(next);
        } catch {
          // The native side is missing on this build: nothing to secure.
        }
      }
    },
    isSecure: () => applied,
    holders: () => [...owners],
  };
}

export const PRIVATE_FOLDER_SECURE_OWNER: SecureWindowOwner = 'private-folder';
export const INCOGNITO_SECURE_OWNER: SecureWindowOwner = 'incognito';
/** Files F10 #916: Security → Block screenshots, for every screen of the app. */
export const APP_SECURE_OWNER: SecureWindowOwner = 'app';

/**
 * The rule for the Private Folder (#689 asks for "private videos"): with the setting on, the window is secure while a
 * Private screen is in front — its PIN gate, its list and its own player of a private video — and nowhere else. Held
 * from when the screen comes into focus (before any of its dialogs open, because React Native copies the flag into a
 * dialog's window only when the dialog is created) until it loses focus; the app going to the background doesn't
 * release it, so the recent-apps preview taken then is blank too.
 */
export function privateFolderHoldsSecure(input: { settingOn: boolean; screenFocused: boolean }): boolean {
  return input.settingOn && input.screenFocused;
}

/**
 * Files F10 #916, the whole-app rule: with Security → Block screenshots on, the window is secure on every screen, for as
 * long as the app runs (Private's own setting still holds it on Private's screens when this one is off).
 */
export function appHoldsSecure(input: { settingOn: boolean }): boolean {
  return input.settingOn;
}
