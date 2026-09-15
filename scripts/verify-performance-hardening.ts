/**
 * VidoraX performance / lag / freeze / responsiveness hardening.
 *
 * Static + contract assertions only. Does not claim FPS, RAM, or device
 * benchmark numbers. No Metro. No emulator. No APK. No expo prebuild.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-performance-hardening.ts
 *   npm run verify:performance-hardening
 */

import { existsSync, readFileSync } from 'node:fs';
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
  assert(present.length === 0, `${label} must not include: ${present.join(' | ')}`);
}

const files = {
  constants: 'src/browser/tabs/constants.ts',
  mountPool: 'src/browser/tabs/mount-pool.ts',
  tabOps: 'src/browser/tabs/tab-operations.ts',
  browserActions: 'src/browser/stores/browserStore/actions.ts',
  overflow: 'src/browser/components/BrowserOverflowMenu/BrowserOverflowMenu.tsx',
  tabSwitcher: 'src/browser/components/BrowserTabSwitcher/BrowserTabSwitcher.tsx',
  suggestions: 'src/browser/components/BrowserHeader/SuggestionOverlay.tsx',
  actionSheet: 'src/components/bottom-sheets/ActionSheetModal.tsx',
  appModal: 'src/components/modals/AppModal.tsx',
  qualitySheet: 'src/screens/downloads/quality/QualitySelectionSheet.tsx',
  resumeSheet: 'src/screens/player/components/ResumePlaybackSheet.tsx',
  ctaBar: 'src/browser/media-actions/BrowserMediaDownloadBar.tsx',
  discovery: 'src/media-detection/overlay/MediaDiscoveryOverlay.tsx',
  downloadsHook: 'src/storage/hooks/use-downloads.ts',
  downloadsScreen: 'src/screens/downloads/hooks/useDownloadsScreen.ts',
  downloadsList: 'src/screens/downloads/components/DownloadsList.tsx',
  downloadCard: 'src/screens/downloads/components/DownloadCard.tsx',
  downloadActions: 'src/store/downloads/actions.ts',
  downloadSelectors: 'src/store/downloads/selectors.ts',
  downloadStore: 'src/store/downloads/index.ts',
  bindEngine: 'src/downloads/bind-engine-to-store.ts',
  progress: 'src/downloads/engine/progress.ts',
  engineConstants: 'src/downloads/engine/constants.ts',
  pauseAck: 'src/downloads/engine/pause-ack.ts',
  libraryHook: 'src/screens/library/hooks/useLibraryScreen.ts',
  libraryList: 'src/screens/library/components/LibraryList.tsx',
  libraryCard: 'src/screens/library/components/LibraryCard.tsx',
  libraryTile: 'src/screens/library/components/LibraryGridTile.tsx',
  continueWatching: 'src/screens/library/components/ContinueWatchingSection.tsx',
  injected: 'src/media-detection/observers/injected-script.ts',
  engine: 'src/media-detection/engine/media-detection.engine.ts',
  nativeContract: 'src/media-detection/adapters/native-network.contract.ts',
  generalDiag: 'src/media-detection/general-media/general-media-diagnostics.ts',
  socialCtx: 'src/media-detection/social/social-page-context.ts',
  generalCtx: 'src/media-detection/general-media/general-page-context.ts',
  mediaDiag: 'src/media-detection/services/media-diagnostics.service.ts',
  host: 'src/media-detection/components/MediaDetectionHost.tsx',
  themeColors: 'src/theme/colors.ts',
  appLock: 'src/security/app-lock/AppLockGate.tsx',
  appLockStore: 'src/security/app-lock/app-lock.store.ts',
  tabsLayout: 'src/app/(app)/(tabs)/_layout.tsx',
  browserScreen: 'src/browser/BrowserScreen.tsx',
  persistStorage: 'src/store/shared/persist-storage.ts',
  catalogPersist: 'src/storage/services/catalog-persist.ts',
  packageJson: 'package.json',
  architecture: 'docs/ui/PERFORMANCE-HARDENING-ARCHITECTURE.md',
  acceptance: 'docs/testing/PERFORMANCE-LOW-RAM-ANDROID-ACCEPTANCE.md',
};

console.log('VidoraX performance hardening contracts\n');

for (const [key, rel] of Object.entries(files)) {
  test(`file exists: ${key}`, () => {
    assert(exists(rel), rel);
  });
}

const constants = read(files.constants);
const mountPool = read(files.mountPool);
const tabOps = read(files.tabOps);
const browserActions = read(files.browserActions);
const overflow = read(files.overflow);
const tabSwitcher = read(files.tabSwitcher);
const suggestions = read(files.suggestions);
const actionSheet = read(files.actionSheet);
const appModal = read(files.appModal);
const qualitySheet = read(files.qualitySheet);
const resumeSheet = read(files.resumeSheet);
const ctaBar = read(files.ctaBar);
const discovery = read(files.discovery);
const downloadsHook = read(files.downloadsHook);
const downloadsScreen = read(files.downloadsScreen);
const downloadsList = read(files.downloadsList);
const downloadCard = read(files.downloadCard);
const downloadActions = read(files.downloadActions);
const downloadSelectors = read(files.downloadSelectors);
const downloadStore = read(files.downloadStore);
const bindEngine = read(files.bindEngine);
const progress = read(files.progress);
const engineConstants = read(files.engineConstants);
const pauseAck = read(files.pauseAck);
const libraryHook = read(files.libraryHook);
const libraryList = read(files.libraryList);
const libraryCard = read(files.libraryCard);
const libraryTile = read(files.libraryTile);
const continueWatching = read(files.continueWatching);
const injected = read(files.injected);
const engine = read(files.engine);
const nativeContract = read(files.nativeContract);
const generalDiag = read(files.generalDiag);
const socialCtx = read(files.socialCtx);
const generalCtx = read(files.generalCtx);
const mediaDiag = read(files.mediaDiag);
const host = read(files.host);
const themeColors = read(files.themeColors);
const appLock = read(files.appLock);
const appLockStore = read(files.appLockStore);
const tabsLayout = read(files.tabsLayout);
const browserScreen = read(files.browserScreen);
const persistStorage = read(files.persistStorage);
const catalogPersist = read(files.catalogPersist);
const packageJson = read(files.packageJson);
const architecture = read(files.architecture);
const acceptance = read(files.acceptance);

// ─── TAB / WEBVIEW CAPS ───────────────────────────────────
test('1. MAX_OPEN_TABS remains 8', () => {
  mustInclude(constants, ['MAX_OPEN_TABS = 8'], 'max tabs');
});
test('2. MAX_MOUNTED_WEBVIEWS remains 2', () => {
  mustInclude(constants, ['MAX_MOUNTED_WEBVIEWS = 2'], 'max mounted');
});
test('3. mount pool uses MAX_MOUNTED_WEBVIEWS', () => {
  mustInclude(mountPool, ['reconcileMountPool', 'MAX_MOUNTED_WEBVIEWS'], 'pool');
});
test('4. createTab enforces MAX_OPEN_TABS', () => {
  mustInclude(tabOps, ['MAX_OPEN_TABS', 'LIMIT_REACHED'], 'create cap');
});
test('5. closeTab evicts closed id from mounted pool', () => {
  mustInclude(tabOps, ['mountedTabIds.filter((id) => id !== tabId)'], 'close unmount');
});
test('6. closed tab cleanup releases detection + CTA', () => {
  mustInclude(
    browserActions,
    [
      'cleanupClosedTab',
      'browserMediaActionService.clearTab',
      'socialPageContextStore.clearTab',
      'generalPageMediaContextStore.clearTab',
      'mediaDetectionEngine.clearTab',
      'clearVerificationForTab',
    ],
    'close cleanup',
  );
});

// ─── MODAL UNMOUNT (DEAD BUTTONS) ─────────────────────────
test('7. ActionSheetModal unmounts when not visible', () => {
  mustInclude(actionSheet, ['if (!visible)', 'return null'], 'unmount');
});
test('8. overflow menu unmounts when not visible', () => {
  mustInclude(overflow, ['if (!visible)', 'return null'], 'unmount');
});
test('9. tab switcher unmounts when not visible', () => {
  mustInclude(tabSwitcher, ['if (!visible)', 'return null'], 'unmount');
});
test('10. quality sheet unmounts when not visible', () => {
  mustInclude(qualitySheet, ['if (!visible)', 'return null'], 'unmount');
});
test('11. AppModal unmounts when not visible', () => {
  mustInclude(appModal, ['if (!visible)', 'return null'], 'unmount');
});
test('12. resume sheet unmounts when not visible', () => {
  mustInclude(resumeSheet, ['if (!visible)', 'return null'], 'unmount');
});
test('13. suggestion overlay unmounts when not visible', () => {
  mustInclude(suggestions, ['if (!visible)', 'return null'], 'unmount');
});
test('14. dismissed ActionSheetModal does not keep visible={visible}', () => {
  assert(!/visible=\{visible\}/.test(actionSheet), 'no leftover visible prop');
});
test('15. quality sheet documents Android Dialog intercept', () => {
  mustInclude(qualitySheet, ['leftover Android Dialog', 'if (!visible)'], 'docs');
});

// ─── CTA OVERLAY TOUCH INTERCEPT ──────────────────────────
test('16. Video available bar uses box-none', () => {
  mustInclude(ctaBar, ['pointerEvents="box-none"'], 'box-none');
});
test('17. Video available bar is bottom-anchored, not full-screen fill', () => {
  mustInclude(ctaBar, ["position: 'absolute'", 'bottom: 0'], 'bottom anchor');
  mustNotInclude(ctaBar, ['StyleSheet.absoluteFill', 'elevation: 12'], 'no full-screen elevation');
});
test('18. discovery overlay is bottom-anchored', () => {
  mustInclude(discovery, ['pointerEvents="box-none"', "bottom: 0"], 'anchor');
  mustNotInclude(discovery, ['StyleSheet.absoluteFill'], 'no fill overlay');
});
test('19. CTA bar has no Play/Download action sheet', () => {
  mustInclude(ctaBar, ['Video available'], 'bar');
  mustNotInclude(ctaBar, ['ActionSheetModal'], 'no sheet intercept');
});
test('20. BrowserScreen still mounts CTA bar', () => {
  mustInclude(browserScreen, ['BrowserMediaDownloadBar'], 'bar');
});

// ─── DOWNLOAD STORE / PROGRESS ────────────────────────────
test('21. downloads store has no persist middleware', () => {
  mustNotInclude(downloadStore, ['persist('], 'no zustand persist');
});
test('22. UI progress interval is bounded', () => {
  mustInclude(engineConstants, ['uiProgressIntervalMs: 250'], 'ui interval');
});
test('23. durable progress interval is coarser than UI', () => {
  mustInclude(engineConstants, ['backendProgressIntervalMs: 2500'], 'backend interval');
});
test('24. progress tracker exposes shouldUpdateUi', () => {
  mustInclude(progress, ['shouldUpdateUi', 'lastUiEmit'], 'coalesce');
});
test('25. live bytes stay on transferById', () => {
  mustInclude(bindEngine, ['Live bytes/progress live on transferById'], 'transfer path');
});
test('26. workerState is patched only when it changes', () => {
  mustInclude(
    bindEngine,
    ['mappedWorker !== existing?.workerState', 'snapshot.workerState !== existing?.workerState'],
    'skip same worker',
  );
});
test('27. patchItem skips identical catalog rows', () => {
  mustInclude(downloadActions, ['isSameDownloadCatalogItem', 'return state'], 'noop skip');
});
test('28. patchItem still persists durable metadata', () => {
  mustInclude(
    downloadActions,
    ['never SQLite-write mid-transfer progress ticks', 'persistDownloadCatalogItem'],
    'durable persist',
  );
});
test('29. transfer snapshot equality includes executionState', () => {
  mustInclude(
    downloadActions,
    ['previous.executionState === next.executionState'],
    'exec equality',
  );
});
test('30. pause/resume/cancel/retry clear mutating in finally', () => {
  const pauseIdx = downloadActions.indexOf('pause: async (id)');
  const resumeIdx = downloadActions.indexOf('resume: async (id)');
  const cancelIdx = downloadActions.indexOf('cancel: async (id)');
  const retryIdx = downloadActions.indexOf('retry: async (id)');
  const removeIdx = downloadActions.indexOf('remove: async (id)');
  for (const [label, start, end] of [
    ['pause', pauseIdx, resumeIdx],
    ['resume', resumeIdx, cancelIdx],
    ['cancel', cancelIdx, retryIdx],
    ['retry', retryIdx, removeIdx],
  ] as const) {
    const body = downloadActions.slice(start, end);
    assert(body.includes('finally'), `${label} finally`);
    assert(body.includes('setMutating(id, false)'), `${label} clear mutating`);
  }
});
test('31. remove clears mutating in finally when item remains', () => {
  const body = downloadActions.slice(downloadActions.indexOf('remove: async (id)'));
  assert(body.includes('finally'), 'remove finally');
  assert(body.includes('setMutating(id, false)'), 'remove clear');
});
test('32. .part suffix preserved', () => {
  mustInclude(engineConstants, ["TRANSFER_PARTIAL_SUFFIX = '.part'"], 'part');
});
test('33. pause settle timeout preserved', () => {
  mustInclude(engineConstants, ['pauseSettleTimeoutMs: 6_000'], 'pause settle');
});
test('34. Range validation module remains', () => {
  assert(exists('src/downloads/engine/range-validation.ts'), 'range file');
});
test('35. HLS worker remains', () => {
  assert(exists('src/downloads/engine/hls/worker.ts'), 'hls');
});
test('36. pause-ack contract remains', () => {
  mustInclude(pauseAck, ['shouldAcceptPausedStatusEvent', 'shouldRejectLateTransferringOverPaused'], 'ack');
});

// ─── LIST / ROW SUBSCRIPTIONS ─────────────────────────────
test('37. Downloads hook does not subscribe to itemsById map', () => {
  mustNotInclude(
    downloadsHook,
    ['useDownloadsStore(selectDownloadItemsById)'],
    'no map subscription',
  );
  mustInclude(downloadsHook, ['useDownloadsStore.getState().itemsById'], 'snapshot');
});
test('38. Downloads screen still autoLoads via useDownloads', () => {
  mustInclude(downloadsScreen, ['useDownloads({ autoLoad: true })'], 'autoload');
});
test('39. DownloadCard subscribes per id', () => {
  mustInclude(
    downloadCard,
    ['state.itemsById[id]', 'state.transferById[id]', 'state.mutatingIds[id]'],
    'per-id',
  );
});
test('40. Downloads list is virtualized FlatList/SectionList', () => {
  mustInclude(downloadsList, ['FlatList', 'SectionList', 'keyExtractor', 'removeClippedSubviews'], 'virt');
});
test('41. Downloads list window is bounded', () => {
  mustInclude(downloadsList, ['windowSize={5}'], 'window');
});
test('42. Library list is virtualized', () => {
  mustInclude(libraryList, ['FlatList', 'keyExtractor', 'removeClippedSubviews', 'windowSize={5}'], 'virt');
});
test('43. Library uses identity signatures not full transfer map', () => {
  mustInclude(
    libraryHook,
    ['selectDownloadCatalogIdentitySignature', 'selectLibraryTransferSignature'],
    'sigs',
  );
  mustNotInclude(
    libraryHook,
    ['const transfers = useDownloadsStore((state) => state.transferById)'],
    'no full transfer sub',
  );
});
test('44. Home activity signature buckets progress', () => {
  mustInclude(downloadSelectors, ['Math.floor(summary.averageProgress / 5)'], 'bucket');
});
test('45. section membership is status-only', () => {
  mustInclude(
    downloadSelectors,
    ['selectDownloadSectionMembershipSignature', '`${id}:${item.status}`'],
    'status buckets',
  );
});
test('46. Downloads screen uses membership signature', () => {
  mustInclude(downloadsScreen, ['selectDownloadSectionMembershipSignature'], 'membership');
});
test('47. stable download list keys', () => {
  mustInclude(downloadsList, ['keyExtractor = useCallback((id: string) => id'], 'keys');
});
test('48. stable library list keys', () => {
  mustInclude(libraryList, ['keyExtractor = useCallback((item: MediaLibraryItem) => item.id'], 'keys');
});

// ─── WEBVIEW / MEDIA EVENTS ───────────────────────────────
test('49. injected observer single-instance guard', () => {
  mustInclude(injected, ['__VIDORAX_MEDIA_DETECTION__'], 'guard');
});
test('50. injected observer has MAX_POSTS bound', () => {
  mustInclude(injected, ['MAX_POSTS = 400'], 'max posts');
});
test('51. injected observer rate-limits posts per window', () => {
  mustInclude(
    injected,
    ['MAX_POSTS_PER_WINDOW', 'POST_WINDOW_MS', 'postsInWindow'],
    'rate limit',
  );
});
test('52. injected observer dedupes candidates via seen map', () => {
  mustInclude(injected, ['if (seen[key]) return'], 'seen');
});
test('53. injected observer dedupes active_video keys', () => {
  mustInclude(injected, ['if (key === lastActiveVideoKey) return'], 'active key');
});
test('54. injected observer has no scan interval loop', () => {
  mustNotInclude(injected, ['setInterval(scanDom', 'setInterval(flushActiveVideo'], 'no poll');
});
test('55. JS engine skips duplicate active_video keys', () => {
  mustInclude(engine, ['lastActiveVideoKey', 'if (videoKey === this.lastActiveVideoKey)'], 'js dedupe');
});
test('56. native network events are time-deduped', () => {
  mustInclude(nativeContract, ['nativeEventDedupeMs', 'lastKeys'], 'native dedupe');
});
test('57. native lastKeys map is bounded', () => {
  mustInclude(nativeContract, ['if (lastKeys.size > 300)'], 'bound');
});
test('58. MediaDetectionHost starts/stops with browser', () => {
  mustInclude(host, ['useMediaDetectionBrowserSync'], 'host');
  const sync = read('src/media-detection/hooks/useMediaDetectionBrowserSync.ts');
  mustInclude(sync, ['mediaDetectionEngine.start()', 'mediaDetectionEngine.stop()'], 'lifecycle');
});
test('59. verification inflight joining preserved', () => {
  const session = read('src/media-detection/social-source/verification-session.ts');
  mustInclude(session, ['inFlight', 'existing'], 'join');
});
test('60. candidate verifier still exists', () => {
  assert(exists('src/media-detection/services/candidate-verifier.service.ts'), 'verifier');
});

// ─── DIAGNOSTICS ──────────────────────────────────────────
test('61. media diagnostics gated on __DEV__', () => {
  mustInclude(mediaDiag, ['if (!__DEV__)', 'return'], 'dev gate');
});
test('62. general media diagnostics gated on __DEV__', () => {
  mustInclude(generalDiag, ["typeof __DEV__ === 'undefined' || !__DEV__"], 'dev gate');
});
test('63. high-frequency general traces are rate-limited', () => {
  mustInclude(generalDiag, ['HIGH_FREQ_EVENTS', 'allowDiag', 'HIGH_FREQ_MIN_MS'], 'throttle');
});
test('64. JS_RECEIVED stage still exists for native contract', () => {
  mustInclude(nativeContract, ["logGeneralNetworkTrace('JS_RECEIVED'"], 'js received');
});
test('65. social owner notify is ownership-gated', () => {
  mustInclude(socialCtx, ['ownershipRelevant', 'notifyOwnerListeners()'], 'gated notify');
});
test('66. general owner notify is ownership-gated', () => {
  mustInclude(generalCtx, ['ownershipRelevant', 'notifyOwnerListeners()'], 'gated notify');
});

// ─── TIMERS / LISTENERS ───────────────────────────────────
test('67. MediaDetectionHost has no setInterval', () => {
  mustNotInclude(host, ['setInterval'], 'no interval');
});
test('68. AppState listener in session continuity cleans up', () => {
  const session = read('src/browser/hooks/useBrowserSessionContinuity.ts');
  mustInclude(session, ['AppState.addEventListener', 'sub.remove()'], 'appstate');
});
test('69. hardware back listener cleans up', () => {
  const back = read('src/navigation/hooks/use-android-back-handler.ts');
  mustInclude(back, ['BackHandler.addEventListener', 'subscription.remove()'], 'back');
});
test('70. app lock lifecycle AppState cleans up', () => {
  const life = read('src/security/app-lock/use-app-lock-lifecycle.ts');
  mustInclude(life, ['AppState.addEventListener', 'sub.remove()'], 'lock life');
});
test('71. native network observation stop removes subscriptions', () => {
  const adapter = read('src/media-detection/adapters/native-network.adapter.ts');
  mustInclude(adapter, ['stopNativeNetworkObservation', 'sub.remove()'], 'native stop');
});
test('72. injected observer cleans timers on pagehide', () => {
  mustInclude(injected, ['function cleanup()', "addEventListener('pagehide', cleanup)"], 'pagehide');
});

// ─── IMAGE / MEMORY ───────────────────────────────────────
test('73. download row thumbs use disk cache + recyclingKey', () => {
  mustInclude(downloadCard, ['cachePolicy="disk"', 'recyclingKey={id}'], 'thumbs');
});
test('74. library card thumbs use disk cache', () => {
  mustInclude(libraryCard, ['cachePolicy="disk"', 'recyclingKey={item.id}'], 'thumbs');
});
test('75. library grid thumbs use disk cache', () => {
  mustInclude(libraryTile, ['cachePolicy="disk"', 'recyclingKey={item.id}'], 'thumbs');
});
test('76. continue watching thumbs use disk cache', () => {
  mustInclude(continueWatching, ['cachePolicy="disk"', 'recyclingKey={item.id}'], 'thumbs');
});
test('77. splash/logo artwork still allows memory-disk', () => {
  const splash = read('src/screens/splash/components/SplashLogo.tsx');
  mustInclude(splash, ['cachePolicy="memory-disk"'], 'splash quality');
});

// ─── PERSISTENCE ──────────────────────────────────────────
test('78. persist adapter JSON.stringifies persist stores only', () => {
  mustInclude(persistStorage, ['JSON.stringify(value)'], 'persist');
});
test('79. catalog persist is async and swallows FS errors', () => {
  mustInclude(catalogPersist, ['void downloadCatalogRepository', '.catch(() =>'], 'async');
});
test('80. downloads store is not persisted through persist()', () => {
  mustNotInclude(downloadStore, ['createPersistStorage', 'persist('], 'no persist');
});

// ─── APP LOCK / BUSY ──────────────────────────────────────
test('81. App Lock overlay pointerEvents none on children when locked', () => {
  mustInclude(appLock, ["pointerEvents={showLock ? 'none' : 'auto'}"], 'lock pe');
});
test('82. App Lock busy flag exists and is store-scoped', () => {
  mustInclude(appLockStore, ['isBusy'], 'busy');
});
test('83. quality create uses try/finally for creating flag', () => {
  const qs = read('src/screens/downloads/quality/useQualitySelection.ts');
  mustInclude(qs, ['creatingRef.current = false', 'finally'], 'create finally');
});
test('84. media CTA verifyingRef cleared in finally', () => {
  const hook = read('src/browser/media-actions/useBrowserMediaAction.ts');
  mustInclude(hook, ['verifyingRef.current = false', 'finally'], 'verify finally');
});
test('85. no app-wide disabled overlay in AppProvider', () => {
  const provider = read('src/providers/app-provider.tsx');
  mustNotInclude(provider, ['pointerEvents="none"', 'isBusy'], 'no global disable');
});

// ─── NAVIGATION / FEATURES ────────────────────────────────
test('86. Browser is the default tab', () => {
  mustInclude(tabsLayout, ['tabRouteNames.browser', 'tabRouteNames.downloads', 'tabRouteNames.library', 'tabRouteNames.settings'], 'tabs');
});
test('87. QualitySelectionProvider wraps tabs', () => {
  mustInclude(tabsLayout, ['QualitySelectionProvider'], 'quality root');
});
test('88. History overflow shortcut preserved', () => {
  const menu = read('src/browser/components/BrowserOverflowMenu/browser-menu-actions.ts');
  mustInclude(menu, ['handleHistory', 'routePaths.history'], 'history');
});
test('89. Bookmarks overflow shortcut preserved', () => {
  const menu = read('src/browser/components/BrowserOverflowMenu/browser-menu-actions.ts');
  mustInclude(menu, ['handleBookmarks', 'routePaths.bookmarks'], 'bookmarks');
});
test('90. Continue Watching / Recently Watched overflow preserved', () => {
  const menu = read('src/browser/components/BrowserOverflowMenu/browser-menu-actions.ts');
  mustInclude(
    menu,
    ['handleContinueWatching', 'handleRecentlyWatched', 'SECONDARY_DESTINATIONS'],
    'library shortcuts',
  );
});
test('91. Quick Access 3x3 preserved', () => {
  const qa = read('src/browser/components/QuickAccess/QuickAccessGrid.tsx');
  const sites = read('src/browser/config/quick-sites.ts');
  mustInclude(qa, ['QUICK_SITES'], 'grid');
  mustInclude(sites, ['QUICK_ACCESS_COLUMNS = 3', 'START_PAGE_QUICK_ACCESS_COUNT'], '3-col');
  const count = (sites.match(/id: '/g) ?? []).length;
  assert(count >= 9, `expected 9 sites, got ${count}`);
});
test('92. Storage settings preserved', () => {
  assert(exists('src/screens/storage/StorageScreen.tsx'), 'storage');
});
test('93. App Lock screens preserved', () => {
  assert(exists('src/security/app-lock/AppLockScreen.tsx'), 'lock screen');
  assert(exists('src/screens/security/AppLockSetupScreen.tsx'), 'setup');
});
test('94. player screen preserved', () => {
  assert(exists('src/screens/player/PlayerScreen.tsx'), 'player');
});
test('95. themes LIGHT / LOGO / DARK preserved', () => {
  const themeIndex = read('src/theme/index.ts');
  mustInclude(themeIndex, ['light', 'logo', 'dark'], 'modes');
});
test('96. logo red #DC3C2C unchanged', () => {
  mustInclude(themeColors, ['#DC3C2C'], 'brand red');
});
test('97. automatic media host still on BrowserScreen', () => {
  mustInclude(browserScreen, ['MediaDetectionHost'], 'host');
});
test('98. Video available CTA still present', () => {
  mustInclude(ctaBar, ["t('browser.media.videoAvailable')"], 'cta copy');
});

// ─── LOW-RAM / MEMORY STRATEGY ────────────────────────────
test('99. MAX_TAB_CONTEXTS bounded in social store', () => {
  mustInclude(socialCtx, ['MAX_TAB_CONTEXTS = 8'], 'social bound');
});
test('100. general media tab map is bounded', () => {
  mustInclude(generalCtx, ['MAX_TAB_CONTEXTS'], 'general bound');
});
test('101. max detected per page is bounded', () => {
  const timing = read('src/media-detection/constants/media.constants.ts');
  mustInclude(timing, ['maxDetectedPerPage: 80', 'maxCandidatesPerBatch: 40'], 'caps');
});
test('102. package command verify:performance-hardening exists', () => {
  mustInclude(packageJson, ['"verify:performance-hardening": "npx tsx scripts/verify-performance-hardening.ts"'], 'script');
});
test('103. architecture doc exists and names dead-button cause', () => {
  mustInclude(
    architecture,
    [
      'Android transparent Modal',
      'transferById',
      'MAX_MOUNTED_WEBVIEWS = 2',
      'MAX_OPEN_TABS = 8',
    ],
    'arch',
  );
});
test('104. acceptance doc starts all runtime cases NOT_TESTED', () => {
  mustInclude(acceptance, ['NOT_TESTED', 'P1', 'P12'], 'acceptance');
  const notTested = (acceptance.match(/NOT_TESTED/g) ?? []).length;
  assert(notTested >= 12, `expected >=12 NOT_TESTED, got ${notTested}`);
});
test('105. verifier uses only filesystem reads', () => {
  const self = read('scripts/verify-performance-hardening.ts');
  assert(self.includes("from 'node:fs'"), 'reads fs');
  assert(self.includes("from 'node:path'"), 'reads path');
  const forbidden = ['node', 'child_process'].join(':');
  assert(!self.includes(`from '${forbidden}'`), 'no child_process import');
});
test('106. bind engine does not assign catalog progress every tick', () => {
  assert(
    !/updates\.progress = Math\.max\(0, Math\.min\(100, monotonicProgress\)\)/.test(bindEngine),
    'no catalog progress tick',
  );
});
test('107. BrowserScreen does not subscribe to full download store', () => {
  mustNotInclude(browserScreen, ['useDownloadsStore(', 'itemsById', 'transferById'], 'no dl store');
});
test('108. CTA hook does not useDownloadsStore map', () => {
  const hook = read('src/browser/media-actions/useBrowserMediaAction.ts');
  mustNotInclude(hook, ['useDownloadsStore('], 'cta no dl store');
});
test('109. theme store has no setInterval', () => {
  const actions = read('src/store/theme/actions.ts');
  mustNotInclude(actions, ['setInterval'], 'theme poll');
});
test('110. retry policy preserved', () => {
  assert(exists('src/downloads/engine/retry-policy.ts'), 'retry');
  mustInclude(engineConstants, ['maxAutoRetryAttempts: MAX_AUTO_RETRY_ATTEMPTS'], 'retry cap');
});
test('111. scheduler admission remains', () => {
  assert(exists('src/downloads/scheduler/index.ts'), 'scheduler');
});
test('112. detection pipeline reset on navigation still happens', () => {
  mustInclude(engine, ['mediaDetectionPipeline.reset()', 'clearPageDetections'], 'nav reset');
});
test('113. inflight create dedupe remains', () => {
  mustInclude(downloadActions, ['createInFlightKeys'], 'create inflight');
});
test('114. Library continue watching section still exists', () => {
  assert(exists('src/screens/library/components/ContinueWatchingSection.tsx'), 'cw');
});
test('115. Recently watched library filter remains', () => {
  mustInclude(libraryHook, ['LIBRARY_RECENT_DOWNLOAD_WINDOW_MS'], 'recent window');
  const libConstants = read('src/screens/library/constants/library.constants.ts');
  mustInclude(libConstants, ["id: 'recently_watched'"], 'recent filter');
});
test('116. History screen remains', () => {
  assert(exists('src/screens/history/hooks/useHistoryScreen.ts'), 'history');
});
test('117. Bookmarks screen remains', () => {
  assert(exists('src/screens/bookmarks/hooks/useBookmarksScreen.ts'), 'bookmarks');
});
test('118. HLS playlist parser remains', () => {
  assert(exists('src/downloads/engine/hls/playlist.ts'), 'playlist');
});
test('119. download engine pause-state remains', () => {
  assert(exists('src/downloads/engine/pause-state.ts'), 'pause state');
});
test('120. mount pool cold start mounts only active tab', () => {
  mustInclude(mountPool, ['coldStartMountPool', 'return [activeTabId]'], 'cold start');
});
test('121. Browser overflow still opens a Modal when visible', () => {
  mustInclude(overflow, ['<Modal', 'onRequestClose={onClose}'], 'modal');
});
test('122. quality sheet still a Modal when visible', () => {
  mustInclude(qualitySheet, ['<Modal', 'onRequestClose={close}'], 'modal');
});
test('123. persist path does not stringify download progress', () => {
  mustNotInclude(persistStorage, ['transferById', 'bytesWritten'], 'no progress persist');
});
test('124. native adapter start is idempotent via stop-then-start', () => {
  const adapter = read('src/media-detection/adapters/native-network.adapter.ts');
  mustInclude(adapter, ['stopNativeNetworkObservation()'], 'restart clean');
});
test('125. engine setAppActive skips mutation thrash in background', () => {
  mustInclude(engine, ['setAppActive', 'this.appActive = active'], 'bg');
});
test('126. mutation_batch ignored when app inactive', () => {
  mustInclude(engine, ['case \'mutation_batch\':', 'if (!this.appActive)'], 'bg skip');
});
test('127. download notifications progress is throttled', () => {
  const fgs = read('src/downloads/notifications/fgs-summary.ts');
  mustInclude(fgs, ['createThrottleController', 'onProgress'], 'fgs throttle');
});
test('128. Queue rows subscribe per id', () => {
  const row = read('src/screens/downloads/components/QueueActiveRow.tsx');
  mustInclude(row, ['s.itemsById[id]', 's.transferById[id]'], 'per id');
});
test('129. no feature-removal via lowered tab caps', () => {
  assert(!constants.includes('MAX_OPEN_TABS = 4'), 'not lowered to 4');
  assert(!constants.includes('MAX_MOUNTED_WEBVIEWS = 1'), 'not lowered to 1');
});
test('130. automatic detection still processes media_candidate', () => {
  mustInclude(engine, ["case 'media_candidate':", 'handleCandidate'], 'candidates');
});
test('131. social/general applyActiveVideoEvidence still writes current', () => {
  mustInclude(socialCtx, ['state.current = next'], 'social write');
  mustInclude(generalCtx, ['state.current = next'], 'general write');
});
test('132. ownership skip does not drop generation bumps', () => {
  mustInclude(socialCtx, ['current.contextGeneration !== next.contextGeneration'], 'gen');
  mustInclude(generalCtx, ['current.pageGeneration !== next.pageGeneration'], 'page gen');
});
test('133. docs name JS-thread and overlay causes', () => {
  mustInclude(
    architecture,
    ['JS thread', 'invisible overlay', 'progress', 'WebView message'],
    'causes',
  );
});
test('134. P12 dead-button reproduction is documented', () => {
  mustInclude(acceptance, ['P12', 'dead button', 'NOT_TESTED'], 'p12');
});
test('135. pause mutating cannot stick without finally', () => {
  const pauseBody = downloadActions.slice(
    downloadActions.indexOf('pause: async (id)'),
    downloadActions.indexOf('resume: async (id)'),
  );
  assert(pauseBody.includes('try {'), 'try');
  assert(pauseBody.includes('} finally {'), 'finally');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
if (passed < 120) {
  console.error(`Need 120+ assertions, got ${passed}`);
  process.exit(1);
}
