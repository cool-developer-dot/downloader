/**
 * B11 — the incognito facts other modules ask about, with no imports (so the tab gate, profile-service.ts, the
 * download request builder and session persistence can all read it without import cycles). The runtime that keeps
 * them up to date is `incognito.service.ts`.
 *
 * - An incognito tab's id starts with {@link INCOGNITO_TAB_PREFIX}: `shouldPersistForTab` refuses it from the id alone.
 * - Each session has its own temporary WebView profile, `vidorax-incog<session>` ({@link newIncognitoProfileName}); a
 *   name is never used twice.
 */

export const INCOGNITO_TAB_PREFIX = 'incog-';

/** The WebView profile name rule for a session (B20's `vidorax-` + 1–32 lowercase letters or digits). */
export const INCOGNITO_PROFILE_PATTERN = /^vidorax-incog[a-z0-9]{1,27}$/;

export function isIncognitoTabId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(INCOGNITO_TAB_PREFIX);
}

export function isIncognitoProfileName(name: string | null | undefined): boolean {
  return typeof name === 'string' && INCOGNITO_PROFILE_PATTERN.test(name);
}

/**
 * A new session's profile name: the time (base 36) and 8 random characters, so it never repeats — even after a
 * restart, and even while WebView is still deleting an earlier session's data.
 */
export function newIncognitoProfileName(now: number = Date.now(), random: () => number = Math.random): string {
  let suffix = '';
  for (let i = 0; i < 8; i += 1) suffix += Math.floor(random() * 36).toString(36);
  return `vidorax-incog${Math.max(0, Math.floor(now)).toString(36)}${suffix}`.slice(0, 'vidorax-'.length + 32);
}

let liveName: string | null = null;
let inFront = false;
let ender: (() => Promise<void>) | null = null;

/** The live session's profile name (null when no incognito tab is open). */
export function liveIncognitoProfile(): string | null {
  return liveName;
}

export function setLiveIncognitoProfile(name: string | null): void {
  liveName = name;
}

/** Whether the tab in front is an incognito tab. */
export function isIncognitoInFront(): boolean {
  return inFront;
}

export function setIncognitoInFront(value: boolean): void {
  inFront = value;
}

/** The session's profile while an incognito tab is in front (downloads and probes use its cookie jar), else null. */
export function incognitoCookieProfile(): string | null {
  return inFront ? liveName : null;
}

let downloadNotifier: (() => void) | null = null;

/** incognito.service.ts: shows #107's notice. */
export function bindIncognitoDownloadNotifier(fn: (() => void) | null): void {
  downloadNotifier = fn;
}

/** B11 #107: a download from an incognito tab started (the downloads code calls this; no UI import there). */
export function notifyIncognitoDownload(): void {
  downloadNotifier?.();
}

/** incognito.service.ts: closes the incognito tabs and wipes the session. */
export function bindIncognitoEnder(fn: (() => Promise<void>) | null): void {
  ender = fn;
}

/** A profile switch or guest mode replaces the tab list: the incognito session ends (and is wiped) first. */
export async function endIncognitoBeforeProfileChange(): Promise<void> {
  if (liveName && ender) await ender();
}
