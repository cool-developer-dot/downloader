/**
 * Phase 1 — Unified Home/Browser navigation static verifier.
 *
 * Usage: npm run verify:unified-browser-phase1
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function startPageIdCount(src: string): number {
  const match = src.match(
    /export const START_PAGE_QUICK_SITE_IDS = \[([\s\S]*?)\] as const/,
  );
  if (!match) return -1;
  return (match[1].match(/'[a-z0-9]+'/g) ?? []).length;
}

console.log('Unified Browser Phase 1 Verification\n');

const tabsLayout = read('src/app/(app)/(tabs)/_layout.tsx');
const indexRoute = read('src/app/(app)/(tabs)/index.tsx');
const browserRoute = read('src/app/(app)/(tabs)/browser.tsx');
const tabItemsSrc = read('src/navigation/config/tab-bar-options.ts');
const routePathsSrc = read('src/navigation/constants/route-paths.ts');
const onboarding = read('src/screens/onboarding/OnboardingScreen.tsx');
const exitBack = read('src/navigation/hooks/use-tab-exit-back-handler.ts');
const homeView = read('src/browser/components/BrowserHome/BrowserHomeView.tsx');
const useHome = read('src/browser/hooks/useBrowserHome.ts');
const addressBar = read('src/browser/hooks/useAddressBar.ts');
const addressBarUi = read('src/browser/components/BrowserHeader/AddressBar.tsx');
const urlUtils = read('src/browser/utils/url.ts');
const navService = read('src/browser/services/navigation.service.ts');
const quickSites = read('src/browser/config/quick-sites.ts');
const quickGrid = read('src/browser/components/QuickAccess/QuickAccessGrid.tsx');
const browserScreen = read('src/browser/BrowserScreen.tsx');
const container = read('src/browser/components/BrowserContainer/BrowserContainer.tsx');
const webView = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');
const tabConstants = read('src/browser/tabs/constants.ts');
const mountPool = read('src/browser/tabs/mount-pool.ts');
const hardwareBack = read('src/browser/hooks/useBrowserHardwareBack.ts');
const toolbarNav = read('src/browser/hooks/useBrowserNavigation.ts');
const overflow = read('src/browser/components/BrowserOverflowMenu/BrowserOverflowControls.tsx');
const menuActions = read('src/browser/components/BrowserOverflowMenu/browser-menu-actions.ts');
const en = read('src/localization/en.ts');
const ur = read('src/localization/ur.ts');
const pkg = read('package.json');
const homeScreen = read('src/screens/home/HomeScreen.tsx');

// ─── NAVIGATION ───────────────────────────────────────────

test('1. Home is not in visible bottom tabs (href null)', () => {
  mustInclude(tabsLayout, ['href: null', 'tabRouteNames.home'], 'hidden home');
  assert(!tabsLayout.includes("tabBarLabel: t('nav.home')"), 'no home tab label');
  assert(!tabsLayout.includes("tabBarIcon: tabIcons.home"), 'no home tab icon');
});

test('2. Browser is first/default tab', () => {
  mustInclude(tabsLayout, ['initialRouteName={tabRouteNames.browser}'], 'initial browser');
  const browserScreenIdx = tabsLayout.indexOf(
    '<Tabs.Screen\n          name={tabRouteNames.browser}',
  );
  const downloadsScreenIdx = tabsLayout.indexOf(
    '<Tabs.Screen\n          name={tabRouteNames.downloads}',
  );
  const homeScreenIdx = tabsLayout.indexOf('name={tabRouteNames.home}');
  assert(browserScreenIdx > -1, 'browser screen present');
  assert(downloadsScreenIdx > browserScreenIdx, 'browser before downloads');
  assert(homeScreenIdx > downloadsScreenIdx, 'hidden home after visible tabs');
});

test('3. Downloads remains in tabs', () => {
  mustInclude(tabsLayout, ['tabRouteNames.downloads', "t('nav.downloads')"], 'downloads tab');
});

test('4. Library remains in tabs', () => {
  mustInclude(tabsLayout, ['tabRouteNames.library', "t('nav.library')"], 'library tab');
});

test('5. Settings remains in tabs', () => {
  mustInclude(tabsLayout, ['tabRouteNames.settings', "t('nav.settings')"], 'settings tab');
});

test('6. no duplicate Browser/Home visible tabs', () => {
  const browserLabels = tabsLayout.split("tabBarLabel: t('nav.browser')").length - 1;
  assert(browserLabels === 1, `expected 1 browser label, got ${browserLabels}`);
  assert(!tabsLayout.includes("tabBarLabel: t('nav.home')"), 'no home label');
  mustInclude(tabItemsSrc, ['visibleTabItemKeys'], 'visible keys exported');
  mustInclude(
    tabItemsSrc,
    ["'browser'", "'downloads'", "'library'", "'settings'"],
    'visible order keys',
  );
});

test('7. old Home route redirects safely to Browser', () => {
  mustInclude(indexRoute, ['Redirect', 'routePaths.browser'], 'index redirect');
  mustNotInclude(indexRoute, ['HomeScreen'], 'no HomeScreen mount on index');
});

test('8. app launch targets Browser after onboarding', () => {
  mustInclude(onboarding, ['replace(routePaths.browser)'], 'onboarding → browser');
  mustNotInclude(onboarding, ['replace(routePaths.home)'], 'onboarding not home');
});

// ─── START PAGE ───────────────────────────────────────────

test('9. minimal Browser start page exists', () => {
  mustInclude(homeView, ['BrowserHomeView', 'browser-start-intro', 'START_PAGE_QUICK_SITES'], 'start page');
  mustInclude(container, ['BrowserHomeView', 'selectIsHome'], 'shown when home url');
});

test('10. omnibox present on Browser chrome', () => {
  mustInclude(browserScreen, ['BrowserHeader'], 'header chrome');
  mustInclude(browserScreen, ['BrowserTabBadge', 'BrowserOverflowControls'], 'tabs + overflow slots');
  assert(exists('src/browser/components/BrowserHeader/AddressBar.tsx'), 'AddressBar component');
});

test('11. tab control present', () => {
  mustInclude(browserScreen, ['BrowserTabBadge', 'BrowserTabSwitcher'], 'tab control');
  mustInclude(en, ["tabSwitcherOpenA11y"], 'tab a11y key');
});

test('12. overflow present', () => {
  assert(exists('src/browser/components/BrowserOverflowMenu/BrowserOverflowControls.tsx'), 'overflow file');
  mustInclude(browserScreen, ['BrowserOverflowControls'], 'overflow wired');
  mustInclude(en, ['openMenuA11y'], 'overflow a11y');
});

test('13. Quick Access present on start page', () => {
  mustInclude(homeView, ['QuickAccessGrid', 'START_PAGE_QUICK_SITES', 'browser.home.quickAccess'], 'QA');
});

test('14. no giant Paste Link button on start page', () => {
  mustNotInclude(homeView, ['pasteLink', 'Paste link', 'HomePrimaryActions'], 'no paste CTA');
});

test('15. no giant Open Browser button on start page', () => {
  mustNotInclude(homeView, ['openBrowser', 'Open Browser'], 'no open browser CTA');
});

test('16. no Analyze Link on landing page', () => {
  mustNotInclude(homeView, ['analyze', 'Analyze', 'Analyze Link'], 'no analyze');
});

test('17. no Active Downloads card on start page', () => {
  mustNotInclude(homeView, ['ActiveDownloads', 'activeDownloads', 'HomeActiveDownloads'], 'no active dl');
});

test('18. no Recent Downloads carousel on start page', () => {
  mustNotInclude(homeView, ['RecentDownloads', 'recentDownloads', 'HomeRecentDownloads'], 'no recent dl');
});

test('19. no Continue Watching on start page', () => {
  mustNotInclude(homeView, ['ContinueWatching', 'continueWatching', 'HomeContinueWatching'], 'no CW');
});

test('20. no Recently Watched on start page', () => {
  mustNotInclude(homeView, ['RecentlyWatched', 'recentlyWatched', 'HomeRecentlyWatched'], 'no RW');
});

test('21. no Storage card on start page', () => {
  mustNotInclude(homeView, ['StorageSummary', 'storage', 'HomeStorageSummary'], 'no storage');
});

test('22. no permanent History section on start page', () => {
  mustNotInclude(
    homeView,
    ['BrowserHistorySection', 'recentHistory', 'browser.home.recentHistory'],
    'no history section',
  );
  mustNotInclude(homeView, ['BrowserHomeTabs', 'BrowserBookmarkGrid'], 'no bookmarks dashboard tabs');
});

// ─── OMNIBOX ──────────────────────────────────────────────

test('23. URL navigation uses existing parser', () => {
  mustInclude(addressBar, ['navigationService.resolveSubmission', 'loadUrlActiveTab'], 'submit path');
  mustInclude(navService, ['classifyNavigationInput', 'resolveSubmission'], 'nav service');
  mustInclude(urlUtils, ['classifyNavigationInput'], 'url classifier');
});

test('24. search term uses existing search path', () => {
  mustInclude(addressBar, ["result.intent.kind === 'search'"], 'search intent');
  mustInclude(urlUtils, ['buildSearchUrl', "kind: 'search'"], 'search builder present');
});

test('25. pasted URL uses existing path (draft → submit)', () => {
  mustInclude(addressBar, ['setDraft', 'resolveSubmission'], 'paste enters draft');
  mustInclude(addressBarUi, ['onSubmitEditing', 'returnKeyType'], 'keyboard go');
});

test('26. no second URL parser introduced in start page / home hook', () => {
  mustNotInclude(useHome, ['classifyNavigationInput', 'new URL', 'resolveSubmission'], 'no second parser');
  mustInclude(useHome, ['loadUrlActiveTab'], 'canonical load only');
});

test('27. no auto clipboard navigation on Browser start / address bar', () => {
  mustNotInclude(addressBar, ['Clipboard', 'getStringAsync', 'expo-clipboard'], 'no auto clipboard');
  mustNotInclude(homeView, ['Clipboard', 'getStringAsync', 'expo-clipboard'], 'start page no clipboard');
  mustNotInclude(useHome, ['Clipboard', 'getStringAsync'], 'hook no clipboard');
});

test('28. keyboard submit supported', () => {
  mustInclude(addressBarUi, ['onSubmitEditing', 'handleSubmit', "returnKeyType=\"go\""], 'keyboard submit');
});

// ─── QUICK ACCESS ─────────────────────────────────────────

test('29. shortcuts use existing Browser navigation', () => {
  mustInclude(useHome, ['loadUrlActiveTab'], 'QA → loadUrlActiveTab');
  mustInclude(homeView, ['onOpenSite={openUrl}'], 'grid wired');
});

test('30. no second browser flow from start page', () => {
  mustNotInclude(useHome, ['pendingNavigationService', 'routePaths.browser', 'navigation.navigate'], 'direct load');
});

test('31. startPage density presentation', () => {
  mustInclude(homeView, ["density=\"startPage\"", 'START_PAGE_QUICK_SITES'], 'startPage density');
});

test('32. platform URLs for start-page sites (no YouTube)', () => {
  mustInclude(
    quickSites,
    [
      "url: 'https://www.instagram.com/'",
      "url: 'https://www.tiktok.com/'",
      "url: 'https://www.facebook.com/'",
      "url: 'https://vimeo.com/'",
      "url: 'https://www.dailymotion.com/'",
      "url: 'https://www.reddit.com/'",
      "url: 'https://www.pinterest.com/'",
      "url: 'https://web.telegram.org/'",
      "url: 'https://x.com/'",
      'START_PAGE_QUICK_SITE_IDS',
      'START_PAGE_QUICK_SITES',
    ],
    'platform urls',
  );
  mustNotInclude(quickSites, ["id: 'youtube'", 'youtube.com'], 'no youtube in registry');
  mustInclude(quickGrid, ['sites =', 'QUICK_SITES'], 'optional sites prop');
});

// ─── WEBVIEW ──────────────────────────────────────────────

test('33. WebView component reused', () => {
  mustInclude(container, ['MountedTabWebView', 'key={tabId}'], 'mounted pool');
  assert(exists('src/browser/components/BrowserContainer/BrowserWebView.tsx'), 'webview file');
});

test('34. no theme/home-based WebView key', () => {
  mustNotInclude(container, ['key={`home', 'key={theme', 'key={mode'], 'no theme keys');
  mustInclude(container, ['key={tabId}'], 'tabId key');
});

test('35. no cookie reset in phase1 start page', () => {
  mustNotInclude(homeView, ['clearCookies', 'CookieManager', 'cookie'], 'no cookies');
  mustNotInclude(useHome, ['clearCookies', 'CookieManager'], 'hook no cookies');
});

test('36. no history reset in start page', () => {
  mustNotInclude(useHome, ['clearHistory', 'removeHistory'], 'no history wipe');
});

test('37. no current tab reset in start page', () => {
  mustNotInclude(useHome, ['resetTabs', 'closeAll', 'switchTab'], 'no tab reset');
});

test('38. no media engine reset in start page', () => {
  mustNotInclude(homeView, ['media-detection', 'MediaDetection', 'browserMediaAction'], 'no media reset');
  mustNotInclude(useHome, ['media-detection', 'MediaDetection'], 'hook isolation');
});

test('39. browser engine unchanged by start page (no engine imports)', () => {
  mustNotInclude(homeView, ['useTabScopedBrowserEngine', 'BrowserWebView', 'useBrowserEngine'], 'no engine rewrite');
});

// ─── TABS ─────────────────────────────────────────────────

test('40. tab count remains (MAX_OPEN_TABS)', () => {
  mustInclude(tabConstants, ['MAX_OPEN_TABS = 8'], 'max tabs');
});

test('41. new tab remains', () => {
  mustInclude(menuActions, ['newTab', 'createTab'], 'new tab action');
  mustInclude(en, ['newTabA11y'], 'new tab a11y');
});

test('42. close tab remains', () => {
  mustInclude(en, ['closeTab', 'tabSwitcherCloseA11y'], 'close tab');
  assert(exists('src/browser/tabs/tab-operations.ts'), 'tab ops');
});

test('43. tab switching remains', () => {
  mustInclude(browserScreen, ['BrowserTabSwitcher'], 'switcher');
  assert(exists('src/browser/tabs/tab-operations.ts'), 'ops file');
});

test('44. mounted-tab policy unchanged', () => {
  mustInclude(tabConstants, ['MAX_MOUNTED_WEBVIEWS = 2'], 'mount cap');
  mustInclude(mountPool, ['reconcileMountPool'], 'mount pool');
});

test('45. max-tabs rule unchanged', () => {
  mustInclude(tabConstants, ['MAX_OPEN_TABS = 8'], 'max 8');
});

// ─── NAVIGATION CONTROLS ──────────────────────────────────

test('46. back preserved', () => {
  mustInclude(toolbarNav, ['goBackForTab'], 'toolbar back');
});

test('47. forward preserved', () => {
  mustInclude(toolbarNav, ['goForwardForTab'], 'toolbar forward');
});

test('48. Android back ownership preserved', () => {
  mustInclude(hardwareBack, ['goBackForTab', 'selectIsHome', 'routePaths.browser'], 'hw back');
  mustInclude(exitBack, ['routePaths.browser'], 'exit on browser tab');
});

test('49. overflow menu preserved', () => {
  mustInclude(overflow, ['BrowserOverflowMenu'], 'overflow menu');
  mustInclude(menuActions, ['bookmarks', 'history', 'downloads', 'settings'], 'menu items');
});

// ─── APP LOCK ─────────────────────────────────────────────

test('50. App Lock unchanged by start page', () => {
  mustNotInclude(homeView, ['AppLock', 'app-lock', 'security'], 'no lock in start');
  mustNotInclude(useHome, ['AppLock', 'secure-store', 'SecureStore'], 'no security store');
});

test('51. unlock lands in Browser via launch path (onboarding → browser)', () => {
  mustInclude(onboarding, ['routePaths.browser'], 'post-gate browser');
  assert(exists('src/app/(app)/_layout.tsx'), 'app lock gate layout exists');
  const appLayout = read('src/app/(app)/_layout.tsx');
  mustInclude(appLayout, ['AppLockGate'], 'gate still wraps app');
});

test('52. no security imports in unified start page', () => {
  mustNotInclude(homeView, ['expo-secure-store', '@/security', 'AppLockGate'], 'isolation');
});

// ─── THEMES ───────────────────────────────────────────────

test('53. Light/Logo/Dark tokens used via useTheme', () => {
  mustInclude(homeView, ['useTheme', 'theme.colors.background'], 'theme tokens');
});

test('54. Logo tokens path intact (useTheme only)', () => {
  mustInclude(homeView, ["from '@/hooks/use-theme'"], 'central theme hook');
});

test('55. Dark tokens path intact', () => {
  mustNotInclude(homeView, ['#000000', '#FFFFFF', 'isDark', "mode === 'dark'"], 'no local dark forks');
});

test('56. no new raw theme colors in start page', () => {
  mustNotInclude(homeView, ['#DC3C2C', 'rgb(', 'rgba('], 'no raw colors');
});

test('57. no theme architecture rewrite', () => {
  assert(exists('src/hooks/use-theme.ts'), 'theme hook intact');
  mustNotInclude(homeView, ['createTheme', 'ThemeProvider'], 'no theme rewrite');
});

// ─── DOWNLOAD ISOLATION ───────────────────────────────────

test('58. no downloader imports in start page / home hook', () => {
  mustNotInclude(homeView, ['@/downloads', 'download.service', 'DownloadScheduler'], 'dl isolation');
  mustNotInclude(useHome, ['@/downloads', 'download.service'], 'hook dl isolation');
});

test('59. no scheduler imports', () => {
  mustNotInclude(homeView, ['scheduler', 'Scheduler'], 'no scheduler');
  mustNotInclude(useHome, ['scheduler', 'Scheduler'], 'hook no scheduler');
});

test('60. no pause/resume changes in phase1 browser files', () => {
  mustNotInclude(homeView, ['pauseDownload', 'resumeDownload'], 'no pause/resume');
});

test('61. no HLS changes in phase1 start page', () => {
  mustNotInclude(homeView, ['hls', 'm3u8', 'HLS'], 'no hls');
});

test('62. no download state changes in start page', () => {
  mustNotInclude(homeView, ['PREPARING', 'DOWNLOADING', 'WAITING_FOR_WIFI'], 'no dl states');
});

// ─── BROWSER ENGINE ISOLATION ─────────────────────────────

test('63. no media detector changes via start page', () => {
  mustNotInclude(homeView, ['MediaDetectionHost', 'detectMedia'], 'no detector');
});

test('64. BrowserContainer still owns home vs webview switch', () => {
  mustInclude(container, ['isHome ? <BrowserHomeView', 'MountedTabWebView'], 'container switch');
});

test('65. no TikTok-specific changes in start page', () => {
  mustNotInclude(homeView, ['tiktok', 'TikTok'], 'no tiktok logic');
});

test('66. no Instagram-specific changes in start page', () => {
  mustNotInclude(homeView, ['instagram', 'Instagram'], 'no ig logic');
});

test('67. no cookie/session changes in start page', () => {
  mustNotInclude(useHome, ['session', 'cookie'], 'no session wipe');
});

test('68. no WebView interception changes in start page', () => {
  mustNotInclude(homeView, ['onShouldStartLoad', 'setSupportMultipleWindows'], 'no intercept');
  mustInclude(webView, ['react-native-webview'], 'webview still present');
});

// ─── LOCALIZATION / A11Y ──────────────────────────────────

test('69. EN strings added/reused', () => {
  mustInclude(
    en,
    [
      "addressPlaceholder: 'Search or paste video link'",
      'startPageA11y',
      "quickAccess: 'Quick Access'",
      "browser: 'Browser'",
    ],
    'en keys',
  );
});

test('70. UR strings added/reused', () => {
  mustInclude(
    ur,
    ['startPageA11y', 'addressPlaceholder', 'فوری رسائی', 'براؤزر'],
    'ur keys',
  );
});

test('71. omnibox accessibility label', () => {
  mustInclude(addressBarUi, ["accessibilityLabel={t('browser.addressBar')}"], 'omnibox a11y');
});

test('72. tab button accessibility label', () => {
  const badge = read('src/browser/components/BrowserHeader/BrowserTabBadge.tsx');
  mustInclude(badge, ['accessibilityLabel'], 'tab badge a11y');
});

test('73. overflow accessibility label', () => {
  mustInclude(overflow, ['accessibilityLabel'], 'overflow a11y');
});

test('74. Quick Access labels', () => {
  mustInclude(homeView, ['home.quickAccessA11y', 'browser.home.quickAccess'], 'QA labels');
  const card = read('src/browser/components/QuickAccess/QuickSiteCard.tsx');
  mustInclude(card, ['accessibilityLabel', 'openSiteA11y'], 'site card a11y');
});

// ─── EXTRA PROJECT CHECKS ─────────────────────────────────

test('75. routePaths.browser remains /browser', () => {
  mustInclude(routePathsSrc, ["browser: '/browser'"], 'browser path');
  mustInclude(routePathsSrc, ["home: '/'"], 'legacy home path kept');
});

test('76. browser route still mounts BrowserScreen', () => {
  mustInclude(browserRoute, ['BrowserScreen'], 'browser route');
});

test('77. legacy HomeScreen dashboard content still exists offline (not deleted blindly)', () => {
  mustInclude(homeScreen, ['HomePrimaryActions', 'HomeActiveDownloads', 'HomeContinueWatching'], 'home files retained');
  assert(!indexRoute.includes('HomeScreen'), 'but not mounted as landing');
});

test('78. package script registered', () => {
  mustInclude(pkg, ['verify:unified-browser-phase1'], 'npm script');
});

test('79. acceptance + architecture docs exist', () => {
  assert(
    exists('docs/testing/UNIFIED-BROWSER-PHASE1-REAL-ANDROID-ACCEPTANCE.md'),
    'acceptance doc',
  );
  assert(exists('docs/ui/UNIFIED-BROWSER-PHASE1-ARCHITECTURE.md'), 'architecture doc');
});

test('80. QualitySelectionProvider still wraps tabs (Paste Link elsewhere)', () => {
  mustInclude(tabsLayout, ['QualitySelectionProvider'], 'provider retained');
});

test('81. full QUICK_SITES registry preserved beyond start subset', () => {
  mustInclude(quickSites, ["id: 'x'", "id: 'twitch'", "id: 'reddit'"], 'extended registry');
  mustInclude(quickSites, ['START_PAGE_QUICK_SITE_IDS'], 'subset ids');
});

test('82. start page top-anchored (no giant vertical centering)', () => {
  mustNotInclude(homeView, ['Carousel', 'HomePrimaryActions', 'justifyContent: \'center\''], 'no dashboard/center');
  mustInclude(homeView, ['alignItems: \'flex-start\'', 'contentPaddingTop'], 'top-anchored intro');
});

// ─── START PAGE UX POLISH ─────────────────────────────────

const homeTokens = read('src/browser/components/BrowserHome/browser-home-tokens.ts');
const qaTokens = read('src/browser/components/QuickAccess/quick-access-tokens.ts');
const qaCard = read('src/browser/components/QuickAccess/QuickSiteCard.tsx');
const toolbarSrc = read('src/browser/components/BrowserToolbar/BrowserToolbar.tsx');
const browserConstants = read('src/browser/constants/browser.constants.ts');
const headerSrc = read('src/browser/components/BrowserHeader/BrowserHeader.tsx');
const reloadStop = read('src/browser/components/BrowserHeader/ReloadStopButton.tsx');
const hubItems = read('src/components/graphics/PlatformHubGraphic/platform-hub-items.ts');
const heroOrbit = read('src/screens/onboarding/gateway/HeroEcosystem/constants.ts');
const trustConsts = read('src/screens/onboarding/trust/constants/trust.constants.ts');
const brandPalette = read('src/theme/colors.ts');

test('83. compact intro exists (left-aligned brand + subtitle)', () => {
  mustInclude(homeView, ['browser-start-intro', 'startSubtitle', "alignItems: 'flex-start'"], 'intro');
});

test('84. title left aligned (not centered brand block)', () => {
  mustInclude(homeView, ["alignItems: 'flex-start'"], 'left align');
  mustNotInclude(homeView, ["alignItems: 'center'"], 'not centered');
});

test('85. subtitle exists in EN/UR', () => {
  mustInclude(en, ["startSubtitle: 'Browse or paste a video link to get started.'"], 'en subtitle');
  mustInclude(ur, ['startSubtitle:'], 'ur subtitle');
});

test('86. Quick Access heading uses compact subtitle variant', () => {
  mustInclude(homeTokens, ["quickAccessHeadingVariant: 'subtitle'"], 'heading size');
  mustInclude(homeView, ['browser.home.quickAccess'], 'heading key');
});

test('87. exactly 9 visible start-page shortcuts', () => {
  mustInclude(quickSites, ['START_PAGE_QUICK_ACCESS_COUNT', 'START_PAGE_QUICK_SITE_IDS'], 'count export');
  assert(startPageIdCount(quickSites) === 9, 'expected 9 start-page ids');
});

test('88. 3-column layout contract', () => {
  mustInclude(quickSites, ['QUICK_ACCESS_COLUMNS = 3'], '3 columns');
  mustInclude(qaTokens, ['columns: 3'], 'token columns');
});

test('89. no YouTube entry in START_PAGE / QUICK_SITES registry', () => {
  assert(!quickSites.includes("'youtube'"), 'no youtube id');
  assert(!quickSites.includes('youtube.com'), 'no youtube.com url');
});

test('90. no YouTube visible card wiring on start page', () => {
  mustNotInclude(homeView, ['youtube', 'YouTube'], 'start view clean');
});

test('91. no app-owned YouTube supported-platform promotion in hubs', () => {
  mustNotInclude(hubItems, ["id: 'youtube'"], 'hub clean');
  mustNotInclude(heroOrbit, ["id: 'youtube'", 'YouTubeMonoIcon'], 'orbit clean');
  assert(!hubItems.includes("label: 'YouTube'"), 'hub has no YouTube label');
});

test('92. no YouTube promotional CTA on start page', () => {
  mustNotInclude(homeView, ['Open YouTube', 'youtube.com'], 'no yt CTA');
});

test('93. generic browser still allows schemes without YouTube blacklist rewrite', () => {
  mustInclude(browserConstants, ['BROWSER_ALLOWED_SCHEMES', "'http:'", "'https:'"], 'allowed schemes');
  // Containment of native youtube: app intents remains (not a browse blacklist).
  mustInclude(browserConstants, ["'youtube:'", "'vnd.youtube:'"], 'native intent schemes still blocked');
});

test('94. user history/bookmarks stores not wiped by start page', () => {
  mustNotInclude(useHome, ['clearHistory', 'removeBookmark', 'bookmarksStore'], 'no wipe');
  assert(exists('src/store/bookmarks'), 'bookmarks store intact');
});

test('95. 9 shortcuts use existing navigation', () => {
  mustInclude(useHome, ['loadUrlActiveTab'], 'nav owner');
  assert(startPageIdCount(quickSites) === 9, '9 sites');
});

test('96. all start-page ids are non-YouTube', () => {
  const ids = (
    quickSites.match(/export const START_PAGE_QUICK_SITE_IDS = \[([\s\S]*?)\] as const/)?.[1].match(
      /'[a-z0-9]+'/g,
    ) ?? []
  ).map((s) => s.replace(/'/g, ''));
  assert(ids.length === 9, `got ${ids.length}`);
  assert(!ids.includes('youtube'), 'youtube absent');
  for (const id of [
    'instagram',
    'tiktok',
    'facebook',
    'vimeo',
    'dailymotion',
    'reddit',
    'pinterest',
    'telegram',
    'x',
  ]) {
    assert(ids.includes(id), `missing ${id}`);
  }
});

test('97. labels localized for brand/subtitle/QA', () => {
  mustInclude(en, ['startSubtitle', "quickAccess: 'Quick Access'", "brand: 'VidoraX'"], 'en');
  mustInclude(ur, ['startSubtitle', 'فوری رسائی', 'VidoraX'], 'ur');
});

test('98. accessibility labels on intro + shortcuts', () => {
  mustInclude(homeView, ['brandA11y', 'startSubtitle', 'home.quickAccessA11y'], 'intro a11y');
  mustInclude(qaCard, ["accessibilityRole=\"button\"", 'openSiteA11y'], 'card a11y');
});

test('99. compact card sizing tokens (startPage)', () => {
  mustInclude(qaTokens, ['startPageOverrides', 'tileMinHeight: 96', 'tileIconSize: 36', 'tileRadius: 16'], 'card size');
});

test('100. equal columns via resolveQuickAccessTileWidth', () => {
  mustInclude(qaTokens, ['resolveQuickAccessTileWidth', 'columns'], 'equal width');
  mustInclude(quickGrid, ['resolveQuickAccessTileWidth'], 'grid uses calc');
});

test('101. responsive width (window dimensions)', () => {
  mustInclude(quickGrid, ['useWindowDimensions'], 'responsive');
  mustNotInclude(quickGrid, ['ScrollView', 'horizontal={true}'], 'no h-scroll');
});

test('102. no horizontal scroll on start grid', () => {
  mustNotInclude(homeView, ['horizontal={true}'], 'no h scroll');
});

test('103. compact vertical gaps in start tokens', () => {
  mustInclude(
    homeTokens,
    [
      'contentPaddingTop: spacing[20]',
      'introToQuickAccessGap: spacing[24]',
      'quickAccessHeadingGap: spacing[12]',
    ],
    'gaps',
  );
});

test('104. toolbar height contract 48–56', () => {
  mustInclude(browserConstants, ['BROWSER_TOOLBAR_HEIGHT = 48'], 'toolbar 48');
  mustInclude(toolbarSrc, ['BROWSER_TOOLBAR_HEIGHT'], 'toolbar uses constant');
});

test('105. no redundant app-owned settings gear on Browser start chrome', () => {
  mustNotInclude(homeView, ['cog', 'settings', 'IconButton'], 'no gear on start');
  mustInclude(reloadStop, ['if (isHome)', 'return null'], 'reload hidden on home');
  mustNotInclude(headerSrc, ['cog', 'settings'], 'header no settings');
});

test('106. Light theme via useTheme tokens on start + cards', () => {
  mustInclude(homeView, ['theme.colors.background'], 'bg token');
  mustInclude(qaCard, ['theme.colors.card', 'theme.colors.border', 'surfacePressed'], 'card tokens');
});

test('107. Logo brand red #DC3C2C unchanged', () => {
  mustInclude(brandPalette, ["brandRed: '#DC3C2C'", "sourceHex: '#DC3C2C'"], 'brand red');
});

test('108. Dark uses surfacePressed token path (no olive fork in start UX)', () => {
  mustInclude(brandPalette, ['surfacePressed: palette.darkPressed'], 'dark pressed');
  mustNotInclude(homeView, ['#1A2517', 'olive', 'sage'], 'no olive/sage in start');
});

test('109. no new raw theme palette in Quick Access cards', () => {
  mustNotInclude(qaCard, ['#DC3C2C', '#FFFFFF', '#000000'], 'no raw hex in cards');
});

test('110. WebView file untouched by this verifier contract (exists + key=tabId)', () => {
  mustInclude(webView, ['react-native-webview'], 'webview');
  mustInclude(container, ['key={tabId}'], 'tab key');
});

test('111. tab-store constants unchanged', () => {
  mustInclude(tabConstants, ['MAX_OPEN_TABS = 8', 'MAX_MOUNTED_WEBVIEWS = 2'], 'tab caps');
});

test('112. media detection host still only on BrowserScreen (not start view)', () => {
  mustInclude(browserScreen, ['MediaDetectionHost'], 'media host');
  mustNotInclude(homeView, ['MediaDetectionHost'], 'not on start');
});

test('113. downloader not imported by start/toolbar polish files', () => {
  mustNotInclude(homeView, ['@/downloads'], 'start');
  mustNotInclude(toolbarSrc, ['@/downloads'], 'toolbar');
  mustNotInclude(qaCard, ['@/downloads'], 'card');
});

test('114. App Lock gate untouched', () => {
  const appLayout = read('src/app/(app)/_layout.tsx');
  mustInclude(appLayout, ['AppLockGate'], 'gate');
  mustNotInclude(homeView, ['AppLockGate', 'SecureStore'], 'start isolated');
});

test('115. trust onboarding demo URL no longer YouTube', () => {
  mustNotInclude(trustConsts, ['youtube.com'], 'trust demo');
  mustInclude(trustConsts, ['vimeo.com'], 'vimeo demo');
});

test('116. header chrome spacing compact (12–16dp band)', () => {
  mustInclude(headerSrc, ['py={12}', 'px={16}'], 'header padding');
});

test('117. brand title uses h3 (24sp) strong typography', () => {
  mustInclude(homeTokens, ["brandTitleVariant: 'h3'", "brandSubtitleVariant: 'bodySmall'"], 'type scale');
});

test('118. pressed feedback uses semantic surfacePressed', () => {
  mustInclude(qaCard, ['surfacePressed'], 'pressed token');
  mustNotInclude(qaCard, ['transform: [{ scale:'], 'no bounce');
});

test('119. bottom nav still Browser/Downloads/Library/Settings only', () => {
  mustInclude(
    tabsLayout,
    [
      'tabRouteNames.browser',
      'tabRouteNames.downloads',
      'tabRouteNames.library',
      'tabRouteNames.settings',
      'href: null',
    ],
    'nav',
  );
});

test('120. start-page Quick Access count export is 9', () => {
  mustInclude(quickSites, ['START_PAGE_QUICK_ACCESS_COUNT = START_PAGE_QUICK_SITE_IDS.length'], 'count alias');
  assert(startPageIdCount(quickSites) === 9, '9 ids');
});

console.log(`\nUnified Browser Phase 1 + Start-page UX: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
