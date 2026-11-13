/**
 * B20 — which browser profile is in use. Each profile keeps its own browsing data:
 *
 * - SQLite: history, bookmarks, recent searches and recent URLs. The default profile keeps them in the app database
 *   (`vidorax.db`), exactly where they were before profiles existed; every other profile has a file of its own with
 *   only those tables (`../sqlite/browser-database.ts`).
 * - MMKV: open tabs, closed tabs, the old single-page session and the browser settings, under `<key>@<id>`
 *   ({@link profileScopedKey}); the default profile keeps the plain keys.
 * - WebView: cookies, site storage and cache, in WebView profile {@link webProfileName} (VidoraWeb.setWebProfile).
 *
 * Downloads, the library, favorites, App Lock and the app's own settings belong to every profile.
 *
 * Guest mode is the profile {@link GUEST_PROFILE_ID}. It ends when the app closes: a cold start that finds it active
 * starts in the profile the user came from and marks the guest's data for wiping (`browserProfileGuestCleanup`).
 */
import { mmkvKeys } from '@/storage/constants';
import { mmkvGetString, mmkvRemove, mmkvSetBoolean, mmkvSetString } from '@/storage/mmkv';

export const DEFAULT_PROFILE_ID = 'default';
export const GUEST_PROFILE_ID = 'guest';

const PROFILE_ID = /^[a-z0-9]{1,24}$/;

/** A profile id: 1–24 lowercase letters and digits (also safe in file names and WebView profile names). */
export function isProfileId(value: unknown): value is string {
  return typeof value === 'string' && PROFILE_ID.test(value);
}

let active: string | null = null;
const listeners = new Set<() => void>();

function readInitialProfile(): string {
  const stored = mmkvGetString(mmkvKeys.browserProfileActive);
  if (stored === GUEST_PROFILE_ID) {
    const back = mmkvGetString(mmkvKeys.browserProfileGuestReturn);
    const next = isProfileId(back) && back !== GUEST_PROFILE_ID ? back : DEFAULT_PROFILE_ID;
    mmkvSetBoolean(mmkvKeys.browserProfileGuestCleanup, true);
    mmkvSetString(mmkvKeys.browserProfileActive, next);
    return next;
  }
  return isProfileId(stored) ? stored : DEFAULT_PROFILE_ID;
}

export function getActiveProfileId(): string {
  if (active === null) {
    active = readInitialProfile();
  }
  return active;
}

export function isGuestActive(): boolean {
  return getActiveProfileId() === GUEST_PROFILE_ID;
}

/** Only the profile switch (src/browser/profiles/profile-switch.ts) calls this, after saving the old profile. */
export function setActiveProfileId(id: string): void {
  if (!isProfileId(id) || id === getActiveProfileId()) {
    return;
  }
  active = id;
  mmkvSetString(mmkvKeys.browserProfileActive, id);
  for (const listener of [...listeners]) {
    listener();
  }
}

export function subscribeActiveProfile(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The MMKV key for this profile's copy of `base`: `base` itself for the default profile, else `base@<id>`. */
export function profileScopedKey(base: string, id: string = getActiveProfileId()): string {
  return id === DEFAULT_PROFILE_ID ? base : `${base}@${id}`;
}

/** The SQLite file of a profile other than the default (which uses the app database). */
export function profileDatabaseName(id: string): string {
  return `vidorax-profile-${id}.db`;
}

/**
 * The WebView profile of a browser profile (vidorax-web's WebProfileNames). Guest mode's changes with every session
 * (`vidorax-guest<session>`): WebView may finish deleting an ended session's data later, so a new session never
 * reuses its name.
 */
export function webProfileName(id: string): string {
  if (id === DEFAULT_PROFILE_ID) return 'Default';
  if (id === GUEST_PROFILE_ID) {
    const session = mmkvGetString(mmkvKeys.browserProfileGuestSession);
    return `vidorax-guest${session && /^[a-z0-9]{1,12}$/.test(session) ? session : ''}`;
  }
  return `vidorax-${id}`;
}

/** B20: a new guest session's WebView profile (see webProfileName). */
export function startGuestSession(random: () => number = Math.random): void {
  mmkvSetString(mmkvKeys.browserProfileGuestSession, Math.floor(random() * 36 ** 8).toString(36).padStart(8, '0'));
}

export function endGuestSession(): void {
  mmkvRemove(mmkvKeys.browserProfileGuestSession);
}

/** Test helper. */
export function __resetActiveProfileForTests(id: string | null = null): void {
  active = id;
  listeners.clear();
}
