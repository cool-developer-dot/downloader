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
  /** P1 #527: the Player's seek interval in seconds (5, 10, 15, 20, 30 or 60; local only). */
  playerSeekStepSeconds: 'vidorax.mmkv.player.seekStepSeconds.v1',
  /** P2 #564–#566: the fit chosen per video, `[mediaId, fit][]`, last 500, oldest first (local only). */
  playerVideoFits: 'vidorax.mmkv.player.videoFits.v1',
  /** P2 #576: full screen lets the picture fill the camera cutout (true) or keeps it clear (false, the default). */
  playerFillCutout: 'vidorax.mmkv.player.fillCutout.v1',
  /** P2 #721: the info overlay (codec, size, frame rate, bit rate, speed) is on. */
  playerInfoOverlay: 'vidorax.mmkv.player.infoOverlay.v1',
  /** P3: per video, `[mediaId, record][]` (chosen subtitle track, subtitle files, sync offset), last 300 (local only). */
  playerSubtitles: 'vidorax.mmkv.player.subtitles.v1',
  /** P3 #590: look for subtitle files named like the video next to it (default on). */
  playerSubtitleAutoDetect: 'vidorax.mmkv.player.subtitleAutoDetect.v1',
  /** P4 #592–#596, #599: the subtitle style (size, colour, font, edge, position, second subtitle's place), app-wide. */
  playerSubtitleStyle: 'vidorax.mmkv.player.subtitleStyle.v1',
  /** P5 #535: what a finished video does — 'stop' (the default, as before P5), 'repeatOne' (#539), 'repeatAll' (#540). */
  playerEndOfPlayback: 'vidorax.mmkv.player.endOfPlayback.v1',
  /** P5 #722: saved A-B loops per video, `[mediaId, loops][]`, last 300 videos, oldest first (local only). */
  playerSavedLoops: 'vidorax.mmkv.player.savedLoops.v1',
  /** P6 #619: the play queue (ids, the order before Shuffle, the video playing), so it survives a restart. */
  playerQueue: 'vidorax.mmkv.player.queue.v1',
  /** P6 #534: Auto Play Next (default off). */
  playerAutoPlayNext: 'vidorax.mmkv.player.autoPlayNext.v1',
  /** P6 #733: the Next Episode Prompt (default on; shows only when the next episode is about to play). */
  playerNextEpisodePrompt: 'vidorax.mmkv.player.nextEpisodePrompt.v1',
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
  /** P8 #586 / #587: the Player's gesture settings (master switch, one switch per gesture, sensitivity), app-wide. */
  playerGestures: 'vidorax.mmkv.player.gestures.v1',
  /** P8 #692: the Player's customized controls, `{ [group]: { order, hidden } }`, app-wide. */
  playerControlsLayout: 'vidorax.mmkv.player.controlsLayout.v1',
  /** P9 #687: Disable History — while true nothing is added to watch history, Continue watching or play counts. */
  playerDisableHistory: 'vidorax.mmkv.player.disableHistory.v1',
  /** P9 #628: library folders hidden from the Library (folder ids; `unfiled` for videos in no folder). */
  libraryExcludedFolders: 'vidorax.mmkv.library.excludedFolders.v1',
  /** P11 #689: Block screenshots and screen recording inside Private (default off). */
  privacyBlockScreenCapture: 'vidorax.mmkv.privacy.blockScreenCapture.v1',
} as const;

export type MmkvKey = (typeof mmkvKeys)[keyof typeof mmkvKeys];
