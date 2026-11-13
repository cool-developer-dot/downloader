export const MMKV_INSTANCE_ID = 'vidorax';

export const mmkvKeys = {
  themeMode: 'vidorax.mmkv.theme.mode',
  language: 'vidorax.mmkv.language',
  wifiOnly: 'vidorax.mmkv.preferences.wifiOnly',
  autoResume: 'vidorax.mmkv.preferences.autoResume',
  notifications: 'vidorax.mmkv.preferences.notifications',
  downloadDirectory: 'vidorax.mmkv.preferences.downloadDirectory',
  maxConcurrentDownloads: 'vidorax.mmkv.preferences.maxConcurrentDownloads',
  /** Versioned envelope for Week 7 download settings (additive). */
  downloadSettings: 'vidorax.mmkv.preferences.downloadSettings.v1',
  /** Bounded terminal notification dedupe map (local only). */
  downloadNotificationEvents: 'vidorax.mmkv.downloads.notificationEvents.v1',
  /** Library grid/list preference (local only). */
  libraryViewMode: 'vidorax.mmkv.library.viewMode.v1',
  /** Player timeline's right label: total length or time left (local only). */
  playerDurationLabelMode: 'vidorax.mmkv.player.durationLabelMode.v1',
  firstLaunch: 'vidorax.mmkv.flags.firstLaunch',
  onboardingComplete: 'vidorax.mmkv.flags.onboardingComplete',
  analyticsEnabled: 'vidorax.mmkv.flags.analyticsEnabled',
  hasSeenBrowserTip: 'vidorax.mmkv.flags.hasSeenBrowserTip',
  browserSession: 'vidorax.mmkv.browser.session',
  /** Phase 3B — open browser tabs metadata (local only). */
  browserTabs: 'vidorax.mmkv.browser.tabs.v1',
  /** B2 #288: the last 10 closed tab groups (per browser profile). */
  browserClosedGroups: 'vidorax.mmkv.browser.closedGroups.v1',
  /** B1 — the last 10 closed tabs (URL, title, position, pinned), for Reopen closed tab and Undo (local only). */
  browserClosedTabs: 'vidorax.mmkv.browser.closedTabs.v1',
  /** B20 — the browser profiles (id, name, colour) and which one is in use; see src/storage/profile. */
  browserProfiles: 'vidorax.mmkv.browser.profiles.v1',
  browserProfileActive: 'vidorax.mmkv.browser.profiles.active.v1',
  /** B20 — the profile guest mode returns to, and guest data still to wipe (the app closed during guest mode). */
  browserProfileGuestReturn: 'vidorax.mmkv.browser.profiles.guestReturn.v1',
  browserProfileGuestCleanup: 'vidorax.mmkv.browser.profiles.guestCleanup.v1',
  /** B20 — WebView profiles of deleted profiles (and ended guest sessions) not removed yet (a WebView still used them). */
  browserProfilePendingDeletes: 'vidorax.mmkv.browser.profiles.pendingDeletes.v2',
  /** B20 — the current guest session's WebView profile suffix: every guest session starts with a new, empty one. */
  browserProfileGuestSession: 'vidorax.mmkv.browser.profiles.guestSession.v1',
  /** B20 — each profile's browser settings while another profile is in use (`@<id>`). */
  browserProfileSettings: 'vidorax.mmkv.browser.profiles.settings.v1',
  browserDesktopMode: 'vidorax.mmkv.browser.desktopMode',
  /** True when the user explicitly toggled Desktop Site (overrides platform recommendation). */
  browserDesktopModeUserExplicit: 'vidorax.mmkv.browser.desktopModeUserExplicit',
  /** One-time Phase 1A catalog seed from engine + store metadata. */
  catalogSeededV1: 'vidorax.mmkv.flags.catalogSeeded.v1',
  /** One-time playback key migration onto the local namespace. */
  playbackMigratedLocalV1: 'vidorax.mmkv.flags.playbackMigratedLocal.v1',
  /** One-time SecureStore cleanup of obsolete auth/session keys. */
  authSecretsClearedV1: 'vidorax.mmkv.flags.authSecretsCleared.v1',
  /** Google Play in-app review: successful-download count and last request time (local only). */
  inAppReview: 'vidorax.mmkv.review.inApp.v1',
  /** One-time move of legacy page/v1 favorites onto library items' own favorites. */
  favoritesPerItemMigratedV1: 'vidorax.mmkv.flags.favoritesPerItemMigrated.v1',
} as const;

export type MmkvKey = (typeof mmkvKeys)[keyof typeof mmkvKeys];
