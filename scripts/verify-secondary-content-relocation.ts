/**
 * Phase 3 — Secondary content relocation (overflow shortcuts, not data copies).
 *
 * Usage: npm run verify:secondary-content-relocation
 *
 * Static + in-memory routing-intent checks. No emulator, APK, expo prebuild, or export.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SECONDARY_DESTINATIONS,
  clearSecondaryDestinationIntentForTests,
  consumeSecondaryDestinationIntent,
  peekSecondaryDestinationIntentForTests,
  requestSecondaryDestination,
} from '../src/navigation/helpers/secondary-destination-intent';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(
      `FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function exists(rel: string): boolean {
  return existsSync(join(ROOT, rel));
}

function mustInclude(src: string, needles: string[], label: string): void {
  const missing = needles.filter((n) => !src.includes(n));
  assert(missing.length === 0, `${label} missing: ${missing.join(' | ')}`);
}

function mustNotInclude(src: string, needles: string[], label: string): void {
  const present = needles.filter((n) => src.includes(n));
  assert(present.length === 0, `${label} forbidden: ${present.join(' | ')}`);
}

console.log('Secondary Content Relocation Verification\n');

const homeView = read('src/browser/components/BrowserHome/BrowserHomeView.tsx');
const useHome = read('src/browser/hooks/useBrowserHome.ts');
const browserScreen = read('src/browser/BrowserScreen.tsx');
const container = read('src/browser/components/BrowserContainer/BrowserContainer.tsx');
const menuActions = read(
  'src/browser/components/BrowserOverflowMenu/browser-menu-actions.ts',
);
const menuTypes = read('src/browser/components/BrowserOverflowMenu/types.ts');
const menuItem = read(
  'src/browser/components/BrowserOverflowMenu/BrowserMenuItem.tsx',
);
const overflowMenu = read(
  'src/browser/components/BrowserOverflowMenu/BrowserOverflowMenu.tsx',
);
const overflowControls = read(
  'src/browser/components/BrowserOverflowMenu/BrowserOverflowControls.tsx',
);
const intentSrc = read(
  'src/navigation/helpers/secondary-destination-intent.ts',
);
const downloadsHook = read('src/screens/downloads/hooks/useDownloadsScreen.ts');
const libraryHook = read('src/screens/library/hooks/useLibraryScreen.ts');
const libraryScreen = read('src/screens/library/LibraryScreen.tsx');
const continueSection = read(
  'src/screens/library/components/ContinueWatchingSection.tsx',
);
const settingsScreen = read('src/screens/settings/SettingsScreen.tsx');
const storageSection = read('src/screens/settings/components/StorageSection.tsx');
const storageScreen = read('src/screens/storage/StorageScreen.tsx');
const storageManager = read(
  'src/storage-manager/hooks/useStorageManager.ts',
);
const indexRoute = read('src/app/(app)/(tabs)/index.tsx');
const tabsLayout = read('src/app/(app)/(tabs)/_layout.tsx');
const tabItems = read('src/navigation/config/tab-bar-options.ts');
const routePathsSrc = read('src/navigation/constants/route-paths.ts');
const homeScreen = read('src/screens/home/HomeScreen.tsx');
const en = read('src/localization/en.ts');
const ur = read('src/localization/ur.ts');
const pkg = read('package.json');
const themeColors = read('src/theme/colors.ts');
const executionState = read(
  'src/downloads/execution/download-execution-state.ts',
);
const stateMachine = read(
  'src/downloads/execution/download-state-machine.ts',
);
const ctaShell = read('src/browser/media-actions/cta-shell-presentation.ts');
const mediaBar = read('src/browser/media-actions/BrowserMediaDownloadBar.tsx');
const mediaAction = read('src/browser/media-actions/useBrowserMediaAction.ts');
const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
const mountPool = read('src/browser/tabs/mount-pool.ts');
const verification = read(
  'src/browser/media-actions/verified-quality-options.ts',
);

clearSecondaryDestinationIntentForTests();

// ─── BROWSER CLEANLINESS ──────────────────────────────────

test('1. Browser start page has no Active Downloads card', () => {
  mustNotInclude(
    homeView,
    ['HomeActiveDownloads', 'activeDownloads', 'Active Downloads'],
    'start',
  );
});

test('2. Browser start page has no Recent Downloads carousel', () => {
  mustNotInclude(
    homeView,
    ['HomeRecentDownloads', 'recentDownloads', 'Recent Downloads'],
    'start',
  );
});

test('3. Browser start page has no Continue Watching section', () => {
  mustNotInclude(
    homeView,
    ['HomeContinueWatching', 'ContinueWatchingSection', 'continueWatching'],
    'start',
  );
});

test('4. Browser start page has no Recently Watched section', () => {
  mustNotInclude(
    homeView,
    ['HomeRecentlyWatched', 'recentlyWatched', 'Recently Watched'],
    'start',
  );
});

test('5. Browser start page has no Storage card', () => {
  mustNotInclude(
    homeView,
    ['HomeStorageSummary', 'StorageSection', 'storage-screen'],
    'start',
  );
});

test('6. Browser start page has no permanent History block', () => {
  mustNotInclude(homeView, ['HistoryList', 'browser.history', 'openHistory'], 'start');
});

test('7. Browser start page has no permanent Bookmarks block', () => {
  mustNotInclude(
    homeView,
    ['BookmarkList', 'browser.bookmarks', 'openBookmarks'],
    'start',
  );
});

test('8. Minimal start page preserved (intro + Quick Access)', () => {
  mustInclude(
    homeView,
    ['browser-start-intro', 'QuickAccessGrid', 'START_PAGE_QUICK_SITES'],
    'start',
  );
});

test('9. Video available bar still mounted on BrowserScreen', () => {
  mustInclude(browserScreen, ['BrowserMediaDownloadBar'], 'browser screen');
});

test('10. Quick Access preserved on start page', () => {
  mustInclude(homeView, ['browser-quick-access-grid', 'density="startPage"'], 'qa');
});

test('11. Start page does not mount HomeScreen dashboard', () => {
  mustNotInclude(homeView, ['HomeScreen', 'HomePrimaryActions', 'HomeHeader'], 'no home');
});

test('12. useBrowserHome does not load download/watch dashboard data', () => {
  mustNotInclude(
    useHome,
    ['useHomeDownloadActivity', 'useContinueWatchingQuery', 'useHomeStorageSummary'],
    'home hook',
  );
});

test('13. Browser container still switches start page vs WebView', () => {
  mustInclude(container, ['BrowserHomeView', 'selectIsHome'], 'container');
});

// ─── MENU SHORTCUTS ───────────────────────────────────────

test('14. Active Downloads menu id exists', () => {
  mustInclude(menuTypes, ["'active_downloads'"], 'types');
  mustInclude(menuActions, ["id: 'active_downloads'"], 'items');
});

test('15. Recent Downloads menu id exists', () => {
  mustInclude(menuTypes, ["'recent_downloads'"], 'types');
  mustInclude(menuActions, ["id: 'recent_downloads'"], 'items');
});

test('16. Continue Watching menu id exists', () => {
  mustInclude(menuTypes, ["'continue_watching'"], 'types');
  mustInclude(menuActions, ["id: 'continue_watching'"], 'items');
});

test('17. Recently Watched menu id exists', () => {
  mustInclude(menuTypes, ["'recently_watched'"], 'types');
  mustInclude(menuActions, ["id: 'recently_watched'"], 'items');
});

test('18. History menu item exists', () => {
  mustInclude(menuActions, ["id: 'history'", 'routePaths.history'], 'history');
});

test('19. Bookmarks menu item exists', () => {
  mustInclude(menuActions, ["id: 'bookmarks'", 'routePaths.bookmarks'], 'bookmarks');
});

test('20. Existing New Tab utility preserved', () => {
  mustInclude(menuActions, ["id: 'new_tab'", 'createTab()'], 'new tab');
});

test('21. Existing desktop/mobile toggle preserved', () => {
  mustInclude(menuActions, ["id: 'desktop_site'", 'setDesktopMode'], 'desktop');
});

test('22. Existing refresh-adjacent utilities preserved (copy/share/external)', () => {
  mustInclude(
    menuActions,
    ["id: 'copy_link'", "id: 'share'", "id: 'open_external'", "id: 'add_bookmark'"],
    'utils',
  );
});

test('23. Settings utility preserved', () => {
  mustInclude(menuActions, ["id: 'settings'", 'routePaths.settings'], 'settings');
});

test('24. Single overflow menu system (existing architecture)', () => {
  mustInclude(overflowControls, ['useBrowserMenuActions', 'BrowserOverflowMenu'], 'one menu');
  assert(exists('src/browser/components/BrowserOverflowMenu/BrowserOverflowMenu.tsx'));
});

test('25. No second menu store created', () => {
  mustNotInclude(menuActions, ['createStore', 'useMenuStore', 'mmkv'], 'no menu store');
  mustNotInclude(intentSrc, ['createStore', 'zustand', 'mmkv', 'AsyncStorage'], 'intent');
});

test('26. Menu does not read downloader internals', () => {
  mustNotInclude(
    menuActions,
    ['useDownloadsStore', 'itemsById', 'orderedIds', 'downloadEngine'],
    'no dl data',
  );
});

test('27. Menu does not read library/playback lists', () => {
  mustNotInclude(
    menuActions,
    ['useLibraryStore', 'useContinueWatchingQuery', 'useRecentPlaybackQuery', 'itemsById'],
    'no lib data',
  );
});

test('28. Menu is a routing layer (intent + navigate)', () => {
  mustInclude(
    menuActions,
    [
      'requestSecondaryDestination',
      'SECONDARY_DESTINATIONS.activeDownloads',
      'SECONDARY_DESTINATIONS.recentDownloads',
      'SECONDARY_DESTINATIONS.continueWatching',
      'SECONDARY_DESTINATIONS.recentlyWatched',
    ],
    'routing',
  );
});

test('29. Menu groups shortcuts with existing divider style', () => {
  mustInclude(menuActions, ['showDividerBefore: true'], 'dividers');
  mustInclude(overflowMenu, ['showDividerBefore', 'Divider'], 'render');
});

test('30. Overflow trigger a11y label preserved', () => {
  mustInclude(overflowControls, ['browser.openMenuA11y', 'accessibilityRole="button"'], 'trigger');
});

test('31. Menu container exposes menu semantics', () => {
  mustInclude(overflowMenu, ['accessibilityRole="menu"', 'browser.menu'], 'menu a11y');
});

test('32. Menu actions expose menuitem semantics', () => {
  mustInclude(menuItem, ['accessibilityRole="menuitem"', 'accessibilityLabel'], 'item a11y');
});

test('33. Menu touch targets remain browser-sized', () => {
  mustInclude(menuItem, ['BROWSER_TOUCH_TARGET'], 'touch');
});

test('34. Menu still uses existing bookmarks store only for Add bookmark', () => {
  mustInclude(menuActions, ['useBookmarksStore', 'addBookmark'], 'add bookmark');
});

// ─── DOWNLOADS ROUTING ────────────────────────────────────

test('35. Active Downloads routes to Downloads tab', () => {
  mustInclude(menuActions, ['handleActiveDownloads', 'routePaths.downloads'], 'active route');
});

test('36. Recent Downloads routes to Downloads tab', () => {
  mustInclude(menuActions, ['handleRecentDownloads', 'routePaths.downloads'], 'recent route');
});

test('37. Active shortcut uses existing running filter', () => {
  assert(SECONDARY_DESTINATIONS.activeDownloads.statusFilter === 'running');
  mustInclude(intentSrc, ["statusFilter: 'running'"], 'running');
});

test('38. Recent shortcut uses existing completed + newest filter', () => {
  assert(SECONDARY_DESTINATIONS.recentDownloads.statusFilter === 'completed');
  assert(SECONDARY_DESTINATIONS.recentDownloads.sort === 'newest');
});

test('39. Downloads screen consumes overflow intent via existing setStatusFilter', () => {
  mustInclude(
    downloadsHook,
    [
      'consumeSecondaryDestinationIntent',
      'setStatusFilter(intent.statusFilter)',
      'load(1)',
    ],
    'consume',
  );
});

test('40. Downloads destination clears search then loads existing catalog', () => {
  mustInclude(downloadsHook, ["setQuery('')", 'setSearchDraft'], 'clear search');
});

test('41. Existing DownloadUiFilter union unchanged', () => {
  const types = read('src/store/downloads/types.ts');
  mustInclude(
    types,
    ["'all'", "'running'", "'queued'", "'paused'", "'completed'", "'failed'"],
    'filters',
  );
});

test('42. Canonical execution states unchanged', () => {
  mustInclude(
    executionState,
    [
      "'PREPARING'",
      "'QUEUED'",
      "'WAITING_FOR_WIFI'",
      "'STARTING'",
      "'DOWNLOADING'",
      "'FINALIZING'",
      "'PAUSED'",
      "'RETRYING'",
      "'COMPLETED'",
      "'FAILED'",
      "'CANCELLED'",
    ],
    'states',
  );
});

test('43. State machine file not rewritten by overflow routing', () => {
  mustInclude(stateMachine, ['PREPARING:', 'WAITING_FOR_WIFI:', 'FINALIZING:'], 'machine');
});

test('44. Overflow does not create a second downloads store', () => {
  mustNotInclude(intentSrc, ['itemsById', 'createDownloadsStore'], 'no dup store');
});

test('45. Downloads hook still uses useDownloads autoLoad', () => {
  mustInclude(downloadsHook, ['useDownloads({ autoLoad: true })'], 'existing hook');
});

test('46. No new download screen added for overflow', () => {
  assert(!exists('src/screens/downloads/ActiveDownloadsScreen.tsx'));
  assert(!exists('src/browser/components/ActiveDownloadsList.tsx'));
});

// ─── LIBRARY ROUTING ──────────────────────────────────────

test('47. Continue Watching routes to Library', () => {
  mustInclude(menuActions, ['handleContinueWatching', 'routePaths.library'], 'cw route');
});

test('48. Recently Watched routes to Library', () => {
  mustInclude(menuActions, ['handleRecentlyWatched', 'routePaths.library'], 'rw route');
});

test('49. Continue Watching uses Library filter all', () => {
  assert(SECONDARY_DESTINATIONS.continueWatching.filter === 'all');
});

test('50. Recently Watched uses existing library filter', () => {
  assert(SECONDARY_DESTINATIONS.recentlyWatched.filter === 'recently_watched');
});

test('51. Library screen consumes overflow intent via existing setFilter', () => {
  mustInclude(
    libraryHook,
    ['consumeSecondaryDestinationIntent', 'setFilter(intent.filter)', "setSearchQuery('')"],
    'lib consume',
  );
});

test('52. Library still renders ContinueWatchingSection on all + empty search', () => {
  mustInclude(
    libraryScreen,
    ["filter === 'all'", 'ContinueWatchingSection', 'continueWatchingItems'],
    'cw ui',
  );
});

test('53. Continue Watching uses existing playback-progress query', () => {
  mustInclude(libraryHook, ['useContinueWatchingQuery'], 'progress source');
});

test('54. Recently Watched uses existing watch-history query', () => {
  mustInclude(libraryHook, ['useRecentPlaybackQuery'], 'history source');
});

test('55. No duplicate watch-history database in overflow layer', () => {
  mustNotInclude(intentSrc, ['sqlite', 'expo-sqlite', 'watch_history'], 'no db');
  mustNotInclude(menuActions, ['listLocalPlaybackSummaries', 'PlaybackSummary'], 'no copy');
});

test('56. Library local media actions still open player path', () => {
  mustInclude(libraryHook, ['playerPath', 'openItemActions'], 'actions');
});

test('57. ContinueWatchingSection still navigates to player', () => {
  mustInclude(continueSection, ['playerPath', 'navigation.push'], 'play');
});

test('58. Library recently_watched empty state preserved', () => {
  mustInclude(libraryScreen, ["filter === 'recently_watched'", 'emptyRecentlyWatchedTitle'], 'empty');
});

// ─── HISTORY / BOOKMARKS ──────────────────────────────────

test('59. History overflow uses existing history route', () => {
  mustInclude(menuActions, ['navigation.push(routePaths.history)'], 'history push');
  mustInclude(routePathsSrc, ['history:'], 'route');
});

test('60. Bookmarks overflow uses existing bookmarks route', () => {
  mustInclude(menuActions, ['navigation.push(routePaths.bookmarks)'], 'bookmarks push');
  mustInclude(routePathsSrc, ['bookmarks:'], 'route');
});

test('61. History shortcut does not reset history', () => {
  mustNotInclude(menuActions, ['clearHistory', 'resetHistory', 'deleteAll'], 'no reset');
});

test('62. Bookmarks shortcut does not reset bookmarks', () => {
  mustNotInclude(menuActions, ['.reset(', 'clearBookmarks', 'deleteAllBookmarks'], 'no reset');
});

test('63. Existing history and bookmarks screens remain', () => {
  assert(exists('src/screens/history/HistoryScreen.tsx') || exists('src/screens/history/index.ts'));
  assert(
    exists('src/screens/bookmarks/BookmarksScreen.tsx') ||
      exists('src/screens/bookmarks/index.ts'),
  );
});

test('64. Menu add-bookmark still writes the existing bookmarks store', () => {
  mustInclude(menuActions, ['addBookmark({', 'useBookmarksStore'], 'write existing');
});

// ─── STORAGE → SETTINGS ───────────────────────────────────

test('65. Storage reachable under Settings', () => {
  mustInclude(settingsScreen, ['StorageSection'], 'settings');
  mustInclude(storageSection, ['routePaths.storage', 'settings.storageSection'], 'row');
});

test('66. Storage screen uses existing storage manager', () => {
  mustInclude(storageScreen, ['useStorageManager', 'snapshot.device'], 'manager');
});

test('67. Storage manager uses existing device-storage service', () => {
  mustInclude(storageManager, ['readDeviceStorageSnapshot'], 'service');
});

test('68. Overflow Storage is not a Browser card', () => {
  mustNotInclude(menuActions, ['routePaths.storage', 'HomeStorageSummary'], 'no storage menu card');
});

test('69. Storage row does not delete files as a side effect of opening', () => {
  mustNotInclude(storageSection, ['unlink', 'deleteAsync', 'clearCache('], 'no delete');
});

test('70. Overflow routing does not change downloader paths', () => {
  mustNotInclude(intentSrc, ['downloadPath', 'documentDirectory', 'FileSystem.'], 'no paths');
  mustNotInclude(menuActions, ['downloadPath', 'documentDirectory'], 'no paths');
});

// ─── OLD HOME / ROUTES ────────────────────────────────────

test('71. `/` still redirects to Browser', () => {
  mustInclude(indexRoute, ['Redirect', 'routePaths.browser'], 'redirect');
  mustNotInclude(indexRoute, ['HomeScreen'], 'no mount');
});

test('72. No visible Home tab', () => {
  mustInclude(tabsLayout, ['href: null'], 'hidden home');
  mustInclude(tabItems, ['browser', 'downloads', 'library', 'settings'], 'tabs');
  mustNotInclude(tabItems, ["name: 'home'", 'nav.homeTab'], 'no home tab copy');
});

test('73. Obsolete dashboard is not the landing mount', () => {
  mustInclude(homeScreen, ['Legacy Home dashboard', 'Not mounted'], 'legacy comment');
  mustNotInclude(tabsLayout, ['HomeScreen'], 'not in tabs');
});

test('74. Shared Home derive/storage helpers not deleted', () => {
  assert(exists('src/screens/home/utils/home-derive.ts'));
  assert(exists('src/screens/home/utils/home-local-index.ts'));
  assert(exists('src/storage-manager/services/storage-summary.service.ts'));
});

test('75. HomeScreen remains on disk for Phase 1 compatibility', () => {
  mustInclude(
    homeScreen,
    ['HomeActiveDownloads', 'HomeContinueWatching', 'HomeStorageSummary'],
    'retained',
  );
});

test('76. No duplicate Home implementation in Browser', () => {
  mustNotInclude(browserScreen, ['HomeScreen', 'HomeRecentDownloads'], 'no dup');
});

test('77. Legacy home route path preserved', () => {
  mustInclude(routePathsSrc, ["home: '/'"], 'legacy path');
});

test('78. Tab order remains Browser / Downloads / Library / Settings', () => {
  const browserIdx = tabsLayout.indexOf('tabRouteNames.browser');
  const downloadsIdx = tabsLayout.indexOf('tabRouteNames.downloads');
  const libraryIdx = tabsLayout.indexOf('tabRouteNames.library');
  const settingsIdx = tabsLayout.indexOf('tabRouteNames.settings');
  assert(browserIdx > 0 && browserIdx < downloadsIdx);
  assert(downloadsIdx < libraryIdx);
  assert(libraryIdx < settingsIdx);
});

// ─── INTENT MODULE ────────────────────────────────────────

test('79. Intent consume is one-shot', () => {
  clearSecondaryDestinationIntentForTests();
  requestSecondaryDestination(SECONDARY_DESTINATIONS.activeDownloads);
  const first = consumeSecondaryDestinationIntent();
  const second = consumeSecondaryDestinationIntent();
  assert(first?.domain === 'downloads');
  assert(second === null);
});

test('80. Peek does not consume', () => {
  clearSecondaryDestinationIntentForTests();
  requestSecondaryDestination(SECONDARY_DESTINATIONS.recentlyWatched);
  const peeked = peekSecondaryDestinationIntentForTests();
  const consumed = consumeSecondaryDestinationIntent();
  assert(peeked?.domain === 'library');
  assert(consumed?.domain === 'library');
  assert(consumeSecondaryDestinationIntent() === null);
});

test('81. Continue Watching intent clears search', () => {
  assert(SECONDARY_DESTINATIONS.continueWatching.clearSearch === true);
});

test('82. Intent module stores no download records', () => {
  mustNotInclude(intentSrc, ['DownloadItem', 'orderedIds', 'thumbnail'], 'routing only');
});

test('83. Intent helpers are exported from navigation helpers', () => {
  const helpers = read('src/navigation/helpers/index.ts');
  mustInclude(
    helpers,
    ['SECONDARY_DESTINATIONS', 'requestSecondaryDestination', 'consumeSecondaryDestinationIntent'],
    'export',
  );
});

test('84. Package script verify:secondary-content-relocation exists', () => {
  mustInclude(pkg, ['verify:secondary-content-relocation'], 'script');
});

// ─── PHASE 2 REGRESSION ───────────────────────────────────

test('85. Video available copy preserved', () => {
  mustInclude(mediaBar, ['browser.media.videoAvailable'], 'bar');
  mustInclude(en, ['videoAvailable:'], 'en');
});

test('86. Actionable CTA shell remains READY / HANDOFF only', () => {
  mustInclude(ctaShell, ['isActionableCtaShell', 'READY', 'HANDOFF'], 'shell');
});

test('87. Play handler preserved on media action hook', () => {
  mustInclude(mediaAction, ['const play = useCallback', 'HANDOFF_IN_PROGRESS'], 'play');
});

test('88. Quality options helper preserved', () => {
  mustInclude(verification, ['selectVerifiedStandaloneQualities'], 'quality');
});

test('89. BrowserScreen still owns the media bar lifecycle', () => {
  mustInclude(browserScreen, ['browserMediaActionService', 'BrowserMediaDownloadBar'], 'lifecycle');
});

test('90. Overflow files do not import media action internals', () => {
  mustNotInclude(
    menuActions,
    ['browserMediaActionService', 'TRACKING_CURRENT_VIDEO', 'enqueueBrowserMediaDownload'],
    'isolation',
  );
});

// ─── ENGINE / FEATURE ISOLATION ───────────────────────────

test('91. Overflow does not modify WebView', () => {
  mustNotInclude(
    menuActions,
    ['react-native-webview', '<WebView', 'injectedJavaScript', 'webviewKey'],
    'webview',
  );
});

test('92. Overflow does not modify tab mount pool', () => {
  mustInclude(mountPool, ['coldStartMountPool', 'MAX_MOUNTED_WEBVIEWS'], 'pool intact');
  mustNotInclude(intentSrc, ['mount-pool', 'WebView'], 'intent');
});

test('93. Overflow does not modify candidate verification', () => {
  mustNotInclude(menuActions, ['verifyCandidate', 'analyzeMediaUrl'], 'verify');
});

test('94. Overflow does not import download engine', () => {
  mustNotInclude(menuActions, ['@/downloads/engine', 'admission-scheduler'], 'engine');
  mustNotInclude(intentSrc, ['@/downloads/engine'], 'intent');
});

test('95. Overflow does not import App Lock / SecureStore', () => {
  mustNotInclude(menuActions, ['AppLock', 'SecureStore', 'expo-secure-store'], 'lock');
  mustNotInclude(intentSrc, ['AppLock', 'SecureStore'], 'intent');
});

test('96. Overflow does not import player engine', () => {
  mustNotInclude(menuActions, ['expo-video', 'usePlayerEngine', 'PlayerView'], 'player');
});

test('97. Overflow does not change file open/share/export', () => {
  mustNotInclude(menuActions, ['content://', 'shareAsync', 'StorageAccessFramework'], 'files');
});

test('98. WebView component still exists unchanged by this phase contract', () => {
  mustInclude(webView, ['react-native-webview'], 'webview');
});

// ─── THEMES / I18N / A11Y ─────────────────────────────────

test('99. Brand red #DC3C2C unchanged', () => {
  mustInclude(themeColors, ["brandRed: '#DC3C2C'", "sourceHex: '#DC3C2C'"], 'brand');
});

test('100. Overflow menu uses theme tokens not a new palette', () => {
  mustInclude(overflowMenu, ['theme.colors.card', 'useTheme'], 'tokens');
  mustNotInclude(overflowMenu, ['#DC3C2C', '#000000', 'createTheme'], 'no fork');
});

test('101. Menu item uses semantic theme colors', () => {
  mustInclude(menuItem, ['theme.colors.textPrimary', 'primaryAlphas'], 'semantic');
});

test('102. EN overflow labels exist', () => {
  mustInclude(
    en,
    [
      "activeDownloads: 'Active Downloads'",
      "recentDownloads: 'Recent Downloads'",
      "continueWatching: 'Continue Watching'",
      "recentlyWatched: 'Recently Watched'",
      "history: 'History'",
      "bookmarks: 'Bookmarks'",
    ],
    'en',
  );
});

test('103. UR overflow labels exist', () => {
  mustInclude(
    ur,
    [
      'activeDownloads:',
      'recentDownloads:',
      'continueWatching:',
      'recentlyWatched:',
      "history: 'ہسٹری'",
      "bookmarks: 'بک مارکس'",
    ],
    'ur',
  );
});

test('104. Storage localized in EN and UR', () => {
  mustInclude(en, ["storageSection: 'Storage'"], 'en storage');
  mustInclude(ur, ['storageSection:'], 'ur storage');
});

test('105. EN/UR a11y labels for overflow shortcuts', () => {
  mustInclude(
    en,
    [
      'activeDownloadsA11y',
      'recentDownloadsA11y',
      'continueWatchingA11y',
      'recentlyWatchedA11y',
      'openHistoryA11y',
      'openBookmarksA11y',
    ],
    'en a11y',
  );
  mustInclude(
    ur,
    [
      'activeDownloadsA11y',
      'recentDownloadsA11y',
      'continueWatchingA11y',
      'recentlyWatchedA11y',
    ],
    'ur a11y',
  );
});

test('106. Menu labels are translated, not hardcoded English ids', () => {
  mustInclude(
    menuActions,
    [
      "t('browser.activeDownloads')",
      "t('browser.recentDownloads')",
      "t('browser.continueWatching')",
      "t('browser.recentlyWatched')",
      "t('browser.history')",
      "t('browser.bookmarks')",
    ],
    'i18n',
  );
});

test('107. Downloads destination controls remain filter-based', () => {
  mustInclude(downloadsHook, ['onSelectFilter', 'DownloadUiFilter'], 'filters');
});

test('108. Library destination controls remain filter-based', () => {
  mustInclude(libraryHook, ['onSelectFilter', 'setFilter'], 'filters');
});

test('109. Settings Storage row remains an accessible button-like row', () => {
  mustInclude(storageSection, ['SettingsRow', 'accessibilityHint', 'manageStorageA11y'], 'a11y');
});

test('110. YouTube not reintroduced on start page Quick Access via overflow phase', () => {
  const quickSites = read('src/browser/config/quick-sites.ts');
  mustNotInclude(quickSites, ["'youtube'", 'youtube.com'], 'no yt promo');
});

test('111. Architecture + acceptance docs exist', () => {
  assert(exists('docs/ui/SECONDARY-CONTENT-RELOCATION-ARCHITECTURE.md'));
  assert(exists('docs/testing/SECONDARY-CONTENT-RELOCATION-REAL-ANDROID-ACCEPTANCE.md'));
});

test('112. Generic Downloads menu item replaced by Active/Recent shortcuts', () => {
  mustNotInclude(menuActions, ["id: 'downloads'"], 'no generic item');
  mustInclude(menuActions, ['routePaths.downloads'], 'still routes downloads');
});

test('113. Downloads filter mapping running → DOWNLOADING preserved', () => {
  const actions = read('src/store/downloads/actions.ts');
  mustInclude(actions, ["case 'running':", "return 'DOWNLOADING'"], 'map');
});

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
