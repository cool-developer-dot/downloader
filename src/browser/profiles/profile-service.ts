/**
 * B20 #206 Multiple profiles, #207 Switch profile, #208 Guest mode. See src/storage/profile/active-profile.ts for
 * what a profile keeps apart. This file owns the list (MMKV `browserProfiles`) and every change of profile:
 *
 * Switch: the leaving profile's tabs, session and browser settings are saved; WebView and the download engine move
 * to the new profile's cookie jar (before any of its WebViews exists); then its settings, tabs, history, bookmarks
 * and recent searches are loaded. Downloads keep running.
 *
 * Guest mode: a fresh profile with default settings. Leaving it (or the next cold start) deletes everything it kept:
 * its database, tabs, previews, cookies and site data. With App Lock on, leaving it locks the app first, so the
 * person handed the phone can't open the owner's profile.
 */
import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';
import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';

import { browserMediaActionService } from '@/browser/media-actions/browser-media-action.service';
import { flushBrowserSessionPersistence } from '@/browser/session';
import { useBrowserStore } from '@/browser/stores';
import { hydrateBrowserState } from '@/browser/stores/browserStore/state';
import { suggestionCache } from '@/browser/suggestions';
import { flushTabEnginePersistence } from '@/browser/tabs/tab-persistence.service';
import { tabSnapshots } from '@/browser/tabs/tab-snapshots';
import { useAppLockStore } from '@/security/app-lock/app-lock.store';
import { mmkvKeys } from '@/storage/constants';
import {
  mmkvGetBoolean,
  mmkvGetObject,
  mmkvGetString,
  mmkvRemove,
  mmkvSetObject,
  mmkvSetString,
} from '@/storage/mmkv';
import {
  DEFAULT_PROFILE_ID,
  endGuestSession,
  GUEST_PROFILE_ID,
  getActiveProfileId,
  profileScopedKey,
  setActiveProfileId,
  startGuestSession,
  webProfileName,
} from '@/storage/profile/active-profile';
import { deleteBrowserProfileDatabase } from '@/storage/sqlite/browser-database';
import { useBookmarksStore } from '@/store/bookmarks';
import { useHistoryStore } from '@/store/history';
import { useRecentSearchesStore } from '@/store/recent-searches';
import { createStore } from '@/store/shared/create-store';

import {
  checkProfileName,
  MAX_PROFILES,
  newProfileId,
  nextProfileColor,
  parseProfiles,
  type BrowserProfile,
  type ProfileNameCheck,
} from './profile-registry';
import { deleteProfileSettings, loadProfileSettings, saveProfileSettings } from './profile-settings';
import { orphanWebProfileNames, ownedWebProfileNames } from './web-profile-sweep';
import {
  endIncognitoBeforeProfileChange,
  isIncognitoProfileName,
  liveIncognitoProfile,
} from '@/browser/incognito/incognito-state';
import { deleteOfflinePagesOf } from '@/browser/capture/offline-files';

/** The native side of a profile change; replaceable in tests. */
export type ProfileNativePort = {
  /** True when WebView keeps each profile's cookies and site data apart. */
  isSeparateDataSupported(): Promise<boolean>;
  setWebProfile(name: string): Promise<boolean>;
  setCookieProfile(name: string): Promise<boolean>;
  deleteWebProfile(name: string): Promise<boolean>;
  /** The WebView profiles that exist (VidoraX's names only). */
  getWebProfileNames(): Promise<string[]>;
  closeBrowserWindows(name: string): Promise<number>;
};

const realPort: ProfileNativePort = {
  isSeparateDataSupported: async () => {
    if (!isVidoraWebAvailable()) return false;
    const web = getVidoraWeb();
    return typeof web.isWebProfileSupported === 'function' ? web.isWebProfileSupported() : false;
  },
  setWebProfile: async (name) => {
    if (!isVidoraWebAvailable()) return false;
    const web = getVidoraWeb();
    return typeof web.setWebProfile === 'function' ? web.setWebProfile(name) : false;
  },
  setCookieProfile: async (name) => {
    if (!isVidoraMediaAvailable()) return false;
    const media = getVidoraMedia();
    return typeof media.setCookieProfile === 'function' ? media.setCookieProfile(name) : false;
  },
  deleteWebProfile: async (name) => {
    if (!isVidoraWebAvailable()) return true;
    const web = getVidoraWeb();
    return typeof web.deleteWebProfile === 'function' ? web.deleteWebProfile(name) : true;
  },
  getWebProfileNames: async () => {
    if (!isVidoraWebAvailable()) return [];
    const web = getVidoraWeb();
    return typeof web.getWebProfileNames === 'function' ? web.getWebProfileNames() : [];
  },
  closeBrowserWindows: async (name) => {
    if (!isVidoraWebAvailable()) return 0;
    const web = getVidoraWeb();
    return typeof web.closeBrowserWindows === 'function' ? web.closeBrowserWindows(name) : 0;
  },
};

let port: ProfileNativePort = realPort;

/** `null` restores the real port. */
export function setProfileNativePortForTests(next: ProfileNativePort | null): void {
  port = next ?? realPort;
}

export type ProfilesState = {
  profiles: BrowserProfile[];
  activeId: string;
  /** A switch (or guest mode starting or ending) is running. */
  switching: boolean;
  /** False when this phone's WebView shares cookies and site data between profiles. */
  separateSiteData: boolean;
};

export const useProfilesStore = createStore<ProfilesState>(() => ({
  profiles: parseProfiles(mmkvGetObject<unknown>(mmkvKeys.browserProfiles)),
  activeId: getActiveProfileId(),
  switching: false,
  separateSiteData: true,
}));

function saveList(profiles: BrowserProfile[]): void {
  mmkvSetObject(mmkvKeys.browserProfiles, profiles);
  useProfilesStore.setState({ profiles });
}

/** Restore (data-transfer.service) adds a backup's profiles; the list's rules still apply. */
export function saveProfileList(profiles: BrowserProfile[]): void {
  saveList(parseProfiles(profiles));
}

/** MMKV keys a profile owns (each profile's copy, `@<id>`); deleted with the profile. */
const PROFILE_SCOPED_KEYS = [mmkvKeys.browserTabs, mmkvKeys.browserClosedTabs, mmkvKeys.browserSession] as const;

/** WebView profile names (not browser profile ids) whose deletion has to wait. */
function pendingDeletes(): string[] {
  const raw = mmkvGetObject<unknown>(mmkvKeys.browserProfilePendingDeletes);
  return Array.isArray(raw) ? raw.filter((name): name is string => typeof name === 'string').slice(0, 20) : [];
}

function setPendingDeletes(names: string[]): void {
  if (names.length === 0) {
    mmkvRemove(mmkvKeys.browserProfilePendingDeletes);
  } else {
    mmkvSetObject(mmkvKeys.browserProfilePendingDeletes, [...new Set(names)].slice(-20));
  }
}

/** Deletes a WebView profile now, or (a WebView still uses it) at the next start, before any WebView exists. */
async function deleteWebProfileSoon(name: string): Promise<void> {
  const deleted = await port.deleteWebProfile(name).catch(() => false);
  setPendingDeletes(deleted ? pendingDeletes().filter((p) => p !== name) : [...pendingDeletes(), name]);
}

/**
 * B11 #109: deletes an ended incognito session's WebView profile (its cookies, storage, cache and service workers).
 * The session's WebViews are being unmounted, which finishes after the React commit, so it tries again after each of
 * `delays`; if WebView still holds it, the delete waits for the next start ({@link deleteWebProfileSoon}). Only
 * `vidorax-incog…` names, and never the live session's.
 */
export async function deleteIncognitoWebProfile(
  name: string,
  delays: readonly number[] = [300, 1000, 3000],
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<boolean> {
  if (!isIncognitoProfileName(name) || name === liveIncognitoProfile()) return false;
  for (const delay of delays) {
    await wait(delay);
    if (name === liveIncognitoProfile()) return false;
    if (await port.deleteWebProfile(name).catch(() => false)) {
      setPendingDeletes(pendingDeletes().filter((p) => p !== name));
      return true;
    }
  }
  await deleteWebProfileSoon(name);
  return false;
}

/** Everything a profile kept on the phone, except its entry in the list. Never for the default profile. */
async function wipeProfileData(id: string): Promise<void> {
  if (id === DEFAULT_PROFILE_ID) return;
  const webName = webProfileName(id);
  await port.closeBrowserWindows(webName).catch(() => 0);
  await deleteBrowserProfileDatabase(id);
  for (const base of PROFILE_SCOPED_KEYS) {
    mmkvRemove(profileScopedKey(base, id));
  }
  deleteProfileSettings(id);
  tabSnapshots.deleteProfile(id);
  // B17 #178: the profile's saved (offline) pages.
  deleteOfflinePagesOf(id);
  if (id === GUEST_PROFILE_ID) {
    // The next guest session gets a new WebView profile, whatever WebView still has to finish deleting.
    endGuestSession();
  }
  await deleteWebProfileSoon(webName);
}

/** Reloads every browser store from the active profile. */
function reloadBrowserStores(): void {
  const hydrated = hydrateBrowserState();
  useBrowserStore.setState(hydrated);
  browserMediaActionService.setActiveTab(hydrated.activeTabId);
  suggestionCache.invalidate();
  useHistoryStore.getState().reset();
  useBookmarksStore.getState().reset();
  useRecentSearchesStore.getState().reset();
  void useHistoryStore.getState().load(1);
  void useBookmarksStore.getState().load(1);
  void useRecentSearchesStore.getState().load(1);
}

async function moveNativeTo(id: string): Promise<void> {
  const name = webProfileName(id);
  await Promise.all([port.setWebProfile(name).catch(() => false), port.setCookieProfile(name).catch(() => false)]);
}

let running: Promise<unknown> | null = null;

async function exclusive<T>(task: () => Promise<T>): Promise<T | 'busy'> {
  if (running) return 'busy';
  useProfilesStore.setState({ switching: true });
  const work = task();
  running = work;
  try {
    return await work;
  } finally {
    running = null;
    useProfilesStore.setState({ switching: false, activeId: getActiveProfileId() });
  }
}

async function performSwitch(to: string): Promise<void> {
  // B11: the tab list is replaced below; a live incognito session is closed and wiped first, never dropped.
  await endIncognitoBeforeProfileChange();
  const from = getActiveProfileId();
  flushTabEnginePersistence();
  flushBrowserSessionPersistence();
  if (from !== GUEST_PROFILE_ID) {
    saveProfileSettings(from);
  }
  // Before the new profile's first WebView exists: a WebView's profile can only be chosen when it is created.
  await moveNativeTo(to);
  setActiveProfileId(to);
  loadProfileSettings(to);
  reloadBrowserStores();
}

export type SwitchOutcome = 'switched' | 'same' | 'busy' | 'missing';

export async function switchProfile(id: string): Promise<SwitchOutcome> {
  if (id === getActiveProfileId()) return 'same';
  if (id !== GUEST_PROFILE_ID && !useProfilesStore.getState().profiles.some((p) => p.id === id)) return 'missing';
  if (getActiveProfileId() === GUEST_PROFILE_ID) {
    // Leaving guest mode always goes through exitGuest, so its data is wiped.
    const outcome = await exitGuest(id);
    return outcome === 'busy' ? 'busy' : 'switched';
  }
  const outcome = await exclusive(() => performSwitch(id));
  return outcome === 'busy' ? 'busy' : 'switched';
}

export type CreateProfileOutcome =
  | { ok: true; profile: BrowserProfile }
  | { ok: false; reason: Exclude<ProfileNameCheck, { ok: true }>['reason'] | 'limit' };

export function createProfile(rawName: string, defaultName: string, now: number = Date.now()): CreateProfileOutcome {
  const { profiles } = useProfilesStore.getState();
  if (profiles.length >= MAX_PROFILES) return { ok: false, reason: 'limit' };
  const check = checkProfileName(rawName, profiles, { defaultName });
  if (!check.ok) return check;
  const profile: BrowserProfile = {
    id: newProfileId(profiles),
    name: check.name,
    color: nextProfileColor(profiles),
    createdAt: now,
  };
  saveList([...profiles, profile]);
  return { ok: true, profile };
}

export function renameProfile(id: string, rawName: string, defaultName: string): ProfileNameCheck {
  const { profiles } = useProfilesStore.getState();
  const check = checkProfileName(rawName, profiles, { exceptId: id, defaultName });
  if (!check.ok) return check;
  saveList(profiles.map((p) => (p.id === id ? { ...p, name: check.name } : p)));
  return check;
}

export type DeleteProfileOutcome = 'deleted' | 'active' | 'default' | 'missing' | 'busy';

/** Deletes a profile that isn't in use, with all its data. */
export async function deleteProfile(id: string): Promise<DeleteProfileOutcome> {
  if (id === DEFAULT_PROFILE_ID) return 'default';
  if (id === getActiveProfileId()) return 'active';
  const { profiles } = useProfilesStore.getState();
  if (!profiles.some((p) => p.id === id)) return 'missing';
  const outcome = await exclusive(async () => {
    saveList(useProfilesStore.getState().profiles.filter((p) => p.id !== id));
    await wipeProfileData(id);
  });
  return outcome === 'busy' ? 'busy' : 'deleted';
}

export function isGuestMode(): boolean {
  return getActiveProfileId() === GUEST_PROFILE_ID;
}

/** #208: starts guest mode from the current profile. */
export async function enterGuest(): Promise<'started' | 'already' | 'busy'> {
  const from = getActiveProfileId();
  if (from === GUEST_PROFILE_ID) return 'already';
  const outcome = await exclusive(async () => {
    // Anything an earlier guest session left (the app was killed) goes first: every guest starts empty.
    await wipeProfileData(GUEST_PROFILE_ID);
    startGuestSession();
    mmkvSetString(mmkvKeys.browserProfileGuestReturn, from);
    await performSwitch(GUEST_PROFILE_ID);
  });
  return outcome === 'busy' ? 'busy' : 'started';
}

/** Ends guest mode: back to the profile it started from (or `to`), then everything the guest kept is deleted. */
export async function exitGuest(to?: string): Promise<'ended' | 'not-guest' | 'busy'> {
  if (getActiveProfileId() !== GUEST_PROFILE_ID) return 'not-guest';
  const { profiles } = useProfilesStore.getState();
  const stored = mmkvGetString(mmkvKeys.browserProfileGuestReturn);
  const back =
    to && profiles.some((p) => p.id === to)
      ? to
      : stored && profiles.some((p) => p.id === stored)
        ? stored
        : DEFAULT_PROFILE_ID;
  // App Lock on: the lock screen covers the owner's profile before it appears.
  useAppLockStore.getState().lock();
  const outcome = await exclusive(async () => {
    await performSwitch(back);
    mmkvRemove(mmkvKeys.browserProfileGuestReturn);
    // The guest's WebViews unmount with its tabs; deleting its WebView profile waits for that.
    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    await wipeProfileData(GUEST_PROFILE_ID);
  });
  return outcome === 'busy' ? 'busy' : 'ended';
}

/** Browser settings → Profiles asks once whether this phone's WebView keeps profiles' site data apart. */
export async function refreshSeparateSiteData(): Promise<void> {
  const separate = await port.isSeparateDataSupported().catch(() => false);
  useProfilesStore.setState({ separateSiteData: separate });
}

/**
 * App start, before the browser shows a page: the native side follows the stored profile, guest data left by a
 * guest session the app closed during is deleted, and profiles whose deletion had to wait are finished.
 */
export async function ensureBrowserProfiles(): Promise<void> {
  const state = useProfilesStore.getState();
  let active = getActiveProfileId();
  if (active !== DEFAULT_PROFILE_ID && !state.profiles.some((p) => p.id === active)) {
    // The list lost it (should not happen): fall back to the default profile rather than an orphan.
    setActiveProfileId(DEFAULT_PROFILE_ID);
    active = DEFAULT_PROFILE_ID;
    loadProfileSettings(active);
    reloadBrowserStores();
  }
  useProfilesStore.setState({ activeId: active });
  // The native side starts in the default profile: nothing to tell it (and WebView isn't loaded early) unless another
  // profile is in use.
  if (active !== DEFAULT_PROFILE_ID) {
    await moveNativeTo(active);
  }
  if (mmkvGetBoolean(mmkvKeys.browserProfileGuestCleanup)) {
    await wipeProfileData(GUEST_PROFILE_ID);
    mmkvRemove(mmkvKeys.browserProfileGuestCleanup);
    mmkvRemove(mmkvKeys.browserProfileGuestReturn);
  }
  for (const name of pendingDeletes()) {
    if (name !== webProfileName(active)) {
      await deleteWebProfileSoon(name);
    }
  }
}

/**
 * WebView profiles no browser profile owns any more (a deletion that never finished, an old guest session) are
 * deleted. Run when Browser settings → Profiles opens: WebView is loaded there anyway, never at app start.
 */
export async function sweepOrphanWebProfiles(): Promise<void> {
  if (running) return;
  const names = await port.getWebProfileNames().catch(() => [] as string[]);
  // B11: the live incognito session's profile is owned too; a sweep never touches it mid-session.
  const owned = ownedWebProfileNames(
    useProfilesStore.getState().profiles.map((p) => webProfileName(p.id)),
    webProfileName(getActiveProfileId()),
    liveIncognitoProfile(),
  );
  for (const name of orphanWebProfileNames(names, owned)) {
    await deleteWebProfileSoon(name);
  }
}
