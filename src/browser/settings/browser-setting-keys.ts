/**
 * Every setting the browser packages (B1–B24) added to `SettingsState`. `browser-settings.audit.test.ts` checks that
 * each one is a primitive with a default (so Settings Backup carries it and Reset restores it) and is persisted by
 * the settings store. Add a key here whenever a browser package adds a setting.
 */
export const BROWSER_SETTING_KEYS = [
  'tabSortOrder',
  'searchEngine',
  'safeSearch',
  'searchLanguage',
  'searchRegion',
  'searchSuggestions',
  'addressBarPosition',
  'addressBarAutoHide',
  'searchShortcuts',
  'swipeNavigation',
  'scrollSpeed',
  'volumeKeyScroll',
  'preloadPages',
  'cookiePolicy',
  'doNotTrack',
  'httpsOnly',
  'insecurePageWarning',
  'javaScript',
  'javaScriptExceptions',
  // B10 (Hamza)
  'saveHistory',
  'clearHistoryOnExit',
  // B21 (Hamza)
  'homepageUrl',
  'startupOption',
  'spellCheck',
  'toolbarButtons',
  'startPageBackground',
  'startPageBackgroundColor',
  'startPageBackgroundGradient',
  'startPageBackgroundPhoto',
] as const;

export type BrowserSettingKey = (typeof BROWSER_SETTING_KEYS)[number];
