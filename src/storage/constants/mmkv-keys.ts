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
  firstLaunch: 'vidorax.mmkv.flags.firstLaunch',
  onboardingComplete: 'vidorax.mmkv.flags.onboardingComplete',
  analyticsEnabled: 'vidorax.mmkv.flags.analyticsEnabled',
  hasSeenBrowserTip: 'vidorax.mmkv.flags.hasSeenBrowserTip',
  browserSession: 'vidorax.mmkv.browser.session',
  /** Phase 3B — open browser tabs metadata (local only). */
  browserTabs: 'vidorax.mmkv.browser.tabs.v1',
  browserDesktopMode: 'vidorax.mmkv.browser.desktopMode',
  /** True when the user explicitly toggled Desktop Site (overrides platform recommendation). */
  browserDesktopModeUserExplicit: 'vidorax.mmkv.browser.desktopModeUserExplicit',
  /** One-time Phase 1A catalog seed from engine + store metadata. */
  catalogSeededV1: 'vidorax.mmkv.flags.catalogSeeded.v1',
  /** One-time playback key migration onto the local namespace. */
  playbackMigratedLocalV1: 'vidorax.mmkv.flags.playbackMigratedLocal.v1',
  /** One-time SecureStore cleanup of obsolete auth/session keys. */
  authSecretsClearedV1: 'vidorax.mmkv.flags.authSecretsCleared.v1',
} as const;

export type MmkvKey = (typeof mmkvKeys)[keyof typeof mmkvKeys];
