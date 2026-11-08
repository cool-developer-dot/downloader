import { persist } from 'zustand/middleware';

import { isSupportedLanguage, normalizeLanguageCode, storageKeys } from '@/constants';
import { normalizeConnectionsPerFile, normalizeLiveRecordingMaxMinutes } from '@/downloads/v2/settings';
import { normalizeDownloadHours } from '@/downloads/v2/conditions';
import { normalizeSpeedLimit } from '@/downloads/v2/speed-limit';
import { normalizeFileExtensionChoice } from '@/downloads/v2/file-extension';
import { normalizeFilenameTemplate } from '@/downloads/v2/filename-template';
import { bindLanguageReader } from '@/localization/translate';
import { createStore } from '@/store/shared/create-store';
import { normalizeAfterDownloadAction } from '@/downloads/v2/after-download';
import { createPersistStorage } from '@/store/shared/persist-storage';
import { normalizeDefaultTab } from '@/navigation/helpers/default-tab';
import { normalizeTabSortOrder } from '@/browser/tabs/tab-list-ops';
import { normalizeAddressBarPosition } from '@/browser/address-bar/address-bar-settings';
import { normalizeScrollSpeed } from '@/browser/scroll/scroll-speed';
import { normalizePreloadPages } from '@/browser/preload/preload-policy';
import {
  bindSearchShortcutsReader,
  parseSearchShortcuts,
  serializeSearchShortcuts,
  type SearchShortcut,
} from '@/browser/search/search-shortcuts';
import {
  bindSearchSettingsReader,
  normalizeSafeSearch,
  normalizeSearchEngineId,
  normalizeSearchLanguage,
  normalizeSearchRegion,
} from '@/browser/search/search-engines';

import {
  normalizeCookiePolicy,
  parseJavaScriptExceptions,
  serializeJavaScriptExceptions,
} from '@/browser/privacy/privacy-settings';

import { createSettingsActions } from './actions';
import { initialSettingsState } from './state';
import type { SettingsState, SettingsStore } from './types';
import { normalizeLimitMb } from '@/downloads/v2/data-usage';
// B21 (Hamza)
import { normalizeStartupOption, readHomepage } from '@/browser/startup/startup-settings';
import { parseToolbarButtons, serializeToolbarButtons } from '@/browser/startup/toolbar-buttons';
import {
  colorPreset,
  gradientPreset,
  normalizeStartPageBackground,
  readStartPagePhoto,
} from '@/browser/startup/start-page-background';
// B3 (Hamza)
import { normalizeTabSleepAfter } from '@/browser/tab-sound/tab-sleep';
// B13 (Hamza)
import { parseSitePermissions, serializeSitePermissions } from '@/browser/site-permissions/site-permissions';
// B15 (Hamza)
import {
  normalizeReaderFontFamily,
  normalizeReaderFontSize,
  normalizeReaderLineSpacing,
  normalizeReaderSpeechRate,
  normalizeReaderTheme,
} from '@/browser/reader/reader-settings';
// B16 (Hamza)
import {
  normalizeColorFilter,
  normalizeForceDark,
  normalizeNightLightStrength,
  normalizePageBrightness,
  normalizePageFontStyle,
  normalizeTextZoom,
  parseSiteDisplays,
  serializeSiteDisplays,
} from '@/browser/page-display/page-display-settings';
// B18 (Hamza)
import {
  normalizeBatterySaver,
  normalizeCacheLimit,
  parseImageExceptions,
  serializeImageExceptions,
} from '@/browser/data-saver/data-saver-settings';

const MIN_CONCURRENT = 1;
const MAX_CONCURRENT = 4;

function unwrapPersistedSettings(persisted: unknown): Partial<SettingsState> {
  if (!persisted || typeof persisted !== 'object') {
    return {};
  }

  const record = persisted as Record<string, unknown>;
  if (record.state && typeof record.state === 'object') {
    return record.state as Partial<SettingsState>;
  }

  return record as Partial<SettingsState>;
}

function parseMaxConcurrentDownloads(
  value: unknown,
  fallback: number,
): number {
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value >= MIN_CONCURRENT && value <= MAX_CONCURRENT) {
      return value;
    }
    return fallback;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (
      Number.isInteger(parsed) &&
      parsed >= MIN_CONCURRENT &&
      parsed <= MAX_CONCURRENT
    ) {
      return parsed;
    }
  }

  return fallback;
}

export const useSettingsStore = createStore<SettingsStore>()(
  persist(
    (set) => ({
      ...initialSettingsState,
      ...createSettingsActions(set),
    }),
    {
      name: storageKeys.userPreferences,
      storage: createPersistStorage<SettingsState>(),
      partialize: (state): SettingsState => ({
        clipboardMonitor: state.clipboardMonitor,
        downloadDirectory: state.downloadDirectory,
        afterDownloadAction: state.afterDownloadAction,
        wifiOnly: state.wifiOnly,
        filenameTemplate: state.filenameTemplate,
        fileExtension: state.fileExtension,
        confirmBeforeStart: state.confirmBeforeStart,
        autoResume: state.autoResume,
        debugLogs: state.debugLogs,
        notifications: state.notifications,
        notificationSound: state.notificationSound,
        notificationVibrate: state.notificationVibrate,
        notificationSilent: state.notificationSilent,
        language: state.language,
        defaultTab: state.defaultTab,
        maxConcurrentDownloads: state.maxConcurrentDownloads,
        dataLimitDailyMb: state.dataLimitDailyMb,
        dataLimitMonthlyMb: state.dataLimitMonthlyMb,
        saveToGallery: state.saveToGallery,
        connectionsPerFile: state.connectionsPerFile,
        backgroundPlayback: state.backgroundPlayback,
        downloadSpeedLimit: state.downloadSpeedLimit,
        downloadHours: state.downloadHours,
        notOnRoaming: state.notOnRoaming,
        pauseOnLowBattery: state.pauseOnLowBattery,
        onlyWhileCharging: state.onlyWhileCharging,
        liveRecording: state.liveRecording,
        liveRecordingMaxMinutes: state.liveRecordingMaxMinutes,
        tapToToggle: state.tapToToggle,
        tabSortOrder: state.tabSortOrder,
        searchEngine: state.searchEngine,
        safeSearch: state.safeSearch,
        searchLanguage: state.searchLanguage,
        searchRegion: state.searchRegion,
        searchSuggestions: state.searchSuggestions,
        addressBarPosition: state.addressBarPosition,
        addressBarAutoHide: state.addressBarAutoHide,
        searchShortcuts: state.searchShortcuts,
        swipeNavigation: state.swipeNavigation,
        scrollSpeed: state.scrollSpeed,
        volumeKeyScroll: state.volumeKeyScroll,
        preloadPages: state.preloadPages,
        cookiePolicy: state.cookiePolicy,
        doNotTrack: state.doNotTrack,
        httpsOnly: state.httpsOnly,
        insecurePageWarning: state.insecurePageWarning,
        javaScript: state.javaScript,
        javaScriptExceptions: state.javaScriptExceptions,
        saveHistory: state.saveHistory,
        clearHistoryOnExit: state.clearHistoryOnExit,
        homepageUrl: state.homepageUrl,
        startupOption: state.startupOption,
        spellCheck: state.spellCheck,
        toolbarButtons: state.toolbarButtons,
        startPageBackground: state.startPageBackground,
        startPageBackgroundColor: state.startPageBackgroundColor,
        startPageBackgroundGradient: state.startPageBackgroundGradient,
        startPageBackgroundPhoto: state.startPageBackgroundPhoto,
        tabSleepAfter: state.tabSleepAfter,
        sitePermissions: state.sitePermissions,
        bookmarksBar: state.bookmarksBar,
        linkCheckWifiOnly: state.linkCheckWifiOnly,
        readerTheme: state.readerTheme,
        readerFontSize: state.readerFontSize,
        readerFontFamily: state.readerFontFamily,
        readerLineSpacing: state.readerLineSpacing,
        readerImages: state.readerImages,
        readerSpeechRate: state.readerSpeechRate,
        pageForceDark: state.pageForceDark,
        pageTextZoom: state.pageTextZoom,
        pageForceZoom: state.pageForceZoom,
        pageTextReflow: state.pageTextReflow,
        pageFontStyle: state.pageFontStyle,
        pageUrduNastaliq: state.pageUrduNastaliq,
        pageColorFilter: state.pageColorFilter,
        pageNightLight: state.pageNightLight,
        pageNightLightStrength: state.pageNightLightStrength,
        pageBrightness: state.pageBrightness,
        pageDisplaySites: state.pageDisplaySites,
        blockImages: state.blockImages,
        imageExceptions: state.imageExceptions,
        imagesWifiOnly: state.imagesWifiOnly,
        dataSaver: state.dataSaver,
        liteMode: state.liteMode,
        lightweightHome: state.lightweightHome,
        batterySaver: state.batterySaver,
        hardwareAcceleration: state.hardwareAcceleration,
        cacheLimitMb: state.cacheLimitMb,
      }),
      merge: (persisted, current) => {
        const raw = unwrapPersistedSettings(persisted);

        return {
          ...current,
          ...raw,
          dataLimitDailyMb:
            raw.dataLimitDailyMb === undefined ? current.dataLimitDailyMb : normalizeLimitMb(raw.dataLimitDailyMb),
          dataLimitMonthlyMb:
            raw.dataLimitMonthlyMb === undefined ? current.dataLimitMonthlyMb : normalizeLimitMb(raw.dataLimitMonthlyMb),
          maxConcurrentDownloads: parseMaxConcurrentDownloads(
            raw.maxConcurrentDownloads,
            current.maxConcurrentDownloads,
          ),
          afterDownloadAction:
            raw.afterDownloadAction === undefined
              ? current.afterDownloadAction
              : normalizeAfterDownloadAction(raw.afterDownloadAction),
          wifiOnly: typeof raw.wifiOnly === 'boolean' ? raw.wifiOnly : current.wifiOnly,
          filenameTemplate:
            typeof raw.filenameTemplate === 'string'
              ? normalizeFilenameTemplate(raw.filenameTemplate)
              : current.filenameTemplate,
          fileExtension:
            raw.fileExtension === undefined ? current.fileExtension : normalizeFileExtensionChoice(raw.fileExtension),
          confirmBeforeStart:
            typeof raw.confirmBeforeStart === 'boolean' ? raw.confirmBeforeStart : current.confirmBeforeStart,
          saveToGallery:
            typeof raw.saveToGallery === 'boolean' ? raw.saveToGallery : current.saveToGallery,
          connectionsPerFile:
            raw.connectionsPerFile === undefined
              ? current.connectionsPerFile
              : normalizeConnectionsPerFile(raw.connectionsPerFile),
          downloadSpeedLimit:
            raw.downloadSpeedLimit === undefined
              ? current.downloadSpeedLimit
              : normalizeSpeedLimit(raw.downloadSpeedLimit),
          backgroundPlayback:
            typeof raw.backgroundPlayback === 'boolean'
              ? raw.backgroundPlayback
              : current.backgroundPlayback,
          downloadHours:
            raw.downloadHours === undefined ? current.downloadHours : normalizeDownloadHours(raw.downloadHours),
          notOnRoaming: typeof raw.notOnRoaming === 'boolean' ? raw.notOnRoaming : current.notOnRoaming,
          pauseOnLowBattery:
            typeof raw.pauseOnLowBattery === 'boolean' ? raw.pauseOnLowBattery : current.pauseOnLowBattery,
          onlyWhileCharging:
            typeof raw.onlyWhileCharging === 'boolean' ? raw.onlyWhileCharging : current.onlyWhileCharging,
          liveRecording: typeof raw.liveRecording === 'boolean' ? raw.liveRecording : current.liveRecording,
          liveRecordingMaxMinutes:
            raw.liveRecordingMaxMinutes === undefined
              ? current.liveRecordingMaxMinutes
              : normalizeLiveRecordingMaxMinutes(raw.liveRecordingMaxMinutes),
          tapToToggle:
            typeof raw.tapToToggle === 'boolean' ? raw.tapToToggle : current.tapToToggle,
          autoResume:
            typeof raw.autoResume === 'boolean' ? raw.autoResume : current.autoResume,
          debugLogs: typeof raw.debugLogs === 'boolean' ? raw.debugLogs : current.debugLogs,
          notifications:
            typeof raw.notifications === 'boolean'
              ? raw.notifications
              : current.notifications,
          notificationSound:
            typeof raw.notificationSound === 'boolean' ? raw.notificationSound : current.notificationSound,
          notificationVibrate:
            typeof raw.notificationVibrate === 'boolean' ? raw.notificationVibrate : current.notificationVibrate,
          notificationSilent:
            typeof raw.notificationSilent === 'boolean' ? raw.notificationSilent : current.notificationSilent,
          language:
            typeof raw.language === 'string' &&
            isSupportedLanguage(normalizeLanguageCode(raw.language))
              ? normalizeLanguageCode(raw.language)
              : current.language,
          defaultTab:
            raw.defaultTab === undefined ? current.defaultTab : normalizeDefaultTab(raw.defaultTab),
          downloadDirectory:
            raw.downloadDirectory === null || typeof raw.downloadDirectory === 'string'
              ? raw.downloadDirectory
              : current.downloadDirectory,
          clipboardMonitor:
            typeof raw.clipboardMonitor === 'boolean' ? raw.clipboardMonitor : current.clipboardMonitor,
          tabSortOrder: raw.tabSortOrder === undefined ? current.tabSortOrder : normalizeTabSortOrder(raw.tabSortOrder),
          searchEngine: raw.searchEngine === undefined ? current.searchEngine : normalizeSearchEngineId(raw.searchEngine),
          safeSearch: raw.safeSearch === undefined ? current.safeSearch : normalizeSafeSearch(raw.safeSearch),
          searchLanguage:
            raw.searchLanguage === undefined ? current.searchLanguage : normalizeSearchLanguage(raw.searchLanguage),
          searchRegion: raw.searchRegion === undefined ? current.searchRegion : normalizeSearchRegion(raw.searchRegion),
          searchSuggestions:
            typeof raw.searchSuggestions === 'boolean' ? raw.searchSuggestions : current.searchSuggestions,
          addressBarPosition:
            raw.addressBarPosition === undefined
              ? current.addressBarPosition
              : normalizeAddressBarPosition(raw.addressBarPosition),
          addressBarAutoHide:
            typeof raw.addressBarAutoHide === 'boolean' ? raw.addressBarAutoHide : current.addressBarAutoHide,
          searchShortcuts:
            typeof raw.searchShortcuts === 'string'
              ? serializeSearchShortcuts(parseSearchShortcuts(raw.searchShortcuts))
              : current.searchShortcuts,
          swipeNavigation:
            typeof raw.swipeNavigation === 'boolean' ? raw.swipeNavigation : current.swipeNavigation,
          scrollSpeed: raw.scrollSpeed === undefined ? current.scrollSpeed : normalizeScrollSpeed(raw.scrollSpeed),
          volumeKeyScroll:
            typeof raw.volumeKeyScroll === 'boolean' ? raw.volumeKeyScroll : current.volumeKeyScroll,
          preloadPages: raw.preloadPages === undefined ? current.preloadPages : normalizePreloadPages(raw.preloadPages),
          cookiePolicy: raw.cookiePolicy === undefined ? current.cookiePolicy : normalizeCookiePolicy(raw.cookiePolicy),
          doNotTrack: typeof raw.doNotTrack === 'boolean' ? raw.doNotTrack : current.doNotTrack,
          httpsOnly: typeof raw.httpsOnly === 'boolean' ? raw.httpsOnly : current.httpsOnly,
          insecurePageWarning:
            typeof raw.insecurePageWarning === 'boolean' ? raw.insecurePageWarning : current.insecurePageWarning,
          javaScript: typeof raw.javaScript === 'boolean' ? raw.javaScript : current.javaScript,
          javaScriptExceptions:
            typeof raw.javaScriptExceptions === 'string'
              ? serializeJavaScriptExceptions(parseJavaScriptExceptions(raw.javaScriptExceptions))
              : current.javaScriptExceptions,
          saveHistory: typeof raw.saveHistory === 'boolean' ? raw.saveHistory : current.saveHistory,
          clearHistoryOnExit:
            typeof raw.clearHistoryOnExit === 'boolean' ? raw.clearHistoryOnExit : current.clearHistoryOnExit,
          homepageUrl: typeof raw.homepageUrl === 'string' ? readHomepage(raw.homepageUrl) : current.homepageUrl,
          startupOption:
            raw.startupOption === undefined ? current.startupOption : normalizeStartupOption(raw.startupOption),
          spellCheck: typeof raw.spellCheck === 'boolean' ? raw.spellCheck : current.spellCheck,
          toolbarButtons:
            typeof raw.toolbarButtons === 'string'
              ? serializeToolbarButtons(parseToolbarButtons(raw.toolbarButtons))
              : current.toolbarButtons,
          startPageBackground:
            raw.startPageBackground === undefined
              ? current.startPageBackground
              : normalizeStartPageBackground(raw.startPageBackground),
          startPageBackgroundColor:
            typeof raw.startPageBackgroundColor === 'string'
              ? colorPreset(raw.startPageBackgroundColor).id
              : current.startPageBackgroundColor,
          startPageBackgroundGradient:
            typeof raw.startPageBackgroundGradient === 'string'
              ? gradientPreset(raw.startPageBackgroundGradient).id
              : current.startPageBackgroundGradient,
          startPageBackgroundPhoto:
            typeof raw.startPageBackgroundPhoto === 'string'
              ? (readStartPagePhoto(raw.startPageBackgroundPhoto) ?? '')
              : current.startPageBackgroundPhoto,
          tabSleepAfter:
            raw.tabSleepAfter === undefined ? current.tabSleepAfter : normalizeTabSleepAfter(raw.tabSleepAfter),
          sitePermissions:
            typeof raw.sitePermissions === 'string'
              ? serializeSitePermissions(parseSitePermissions(raw.sitePermissions))
              : current.sitePermissions,
          bookmarksBar: typeof raw.bookmarksBar === 'boolean' ? raw.bookmarksBar : current.bookmarksBar,
          linkCheckWifiOnly:
            typeof raw.linkCheckWifiOnly === 'boolean' ? raw.linkCheckWifiOnly : current.linkCheckWifiOnly,
          readerTheme:
            raw.readerTheme === undefined ? current.readerTheme : normalizeReaderTheme(raw.readerTheme),
          readerFontSize:
            raw.readerFontSize === undefined ? current.readerFontSize : normalizeReaderFontSize(raw.readerFontSize),
          readerFontFamily:
            raw.readerFontFamily === undefined ? current.readerFontFamily : normalizeReaderFontFamily(raw.readerFontFamily),
          readerLineSpacing:
            raw.readerLineSpacing === undefined ? current.readerLineSpacing : normalizeReaderLineSpacing(raw.readerLineSpacing),
          readerImages: typeof raw.readerImages === 'boolean' ? raw.readerImages : current.readerImages,
          readerSpeechRate:
            raw.readerSpeechRate === undefined ? current.readerSpeechRate : normalizeReaderSpeechRate(raw.readerSpeechRate),
          pageForceDark:
            raw.pageForceDark === undefined ? current.pageForceDark : normalizeForceDark(raw.pageForceDark),
          pageTextZoom:
            raw.pageTextZoom === undefined ? current.pageTextZoom : normalizeTextZoom(raw.pageTextZoom),
          pageForceZoom: typeof raw.pageForceZoom === 'boolean' ? raw.pageForceZoom : current.pageForceZoom,
          pageTextReflow: typeof raw.pageTextReflow === 'boolean' ? raw.pageTextReflow : current.pageTextReflow,
          pageFontStyle:
            raw.pageFontStyle === undefined ? current.pageFontStyle : normalizePageFontStyle(raw.pageFontStyle),
          pageUrduNastaliq: typeof raw.pageUrduNastaliq === 'boolean' ? raw.pageUrduNastaliq : current.pageUrduNastaliq,
          pageColorFilter:
            raw.pageColorFilter === undefined ? current.pageColorFilter : normalizeColorFilter(raw.pageColorFilter),
          pageNightLight: typeof raw.pageNightLight === 'boolean' ? raw.pageNightLight : current.pageNightLight,
          pageNightLightStrength:
            raw.pageNightLightStrength === undefined
              ? current.pageNightLightStrength
              : normalizeNightLightStrength(raw.pageNightLightStrength),
          pageBrightness:
            raw.pageBrightness === undefined ? current.pageBrightness : normalizePageBrightness(raw.pageBrightness),
          pageDisplaySites:
            typeof raw.pageDisplaySites === 'string'
              ? serializeSiteDisplays(parseSiteDisplays(raw.pageDisplaySites))
              : current.pageDisplaySites,
          blockImages: typeof raw.blockImages === 'boolean' ? raw.blockImages : current.blockImages,
          imageExceptions:
            typeof raw.imageExceptions === 'string'
              ? serializeImageExceptions(parseImageExceptions(raw.imageExceptions))
              : current.imageExceptions,
          imagesWifiOnly: typeof raw.imagesWifiOnly === 'boolean' ? raw.imagesWifiOnly : current.imagesWifiOnly,
          dataSaver: typeof raw.dataSaver === 'boolean' ? raw.dataSaver : current.dataSaver,
          liteMode: typeof raw.liteMode === 'boolean' ? raw.liteMode : current.liteMode,
          lightweightHome: typeof raw.lightweightHome === 'boolean' ? raw.lightweightHome : current.lightweightHome,
          batterySaver:
            raw.batterySaver === undefined ? current.batterySaver : normalizeBatterySaver(raw.batterySaver),
          hardwareAcceleration:
            typeof raw.hardwareAcceleration === 'boolean' ? raw.hardwareAcceleration : current.hardwareAcceleration,
          cacheLimitMb:
            raw.cacheLimitMb === undefined ? current.cacheLimitMb : normalizeCacheLimit(raw.cacheLimitMb),
        };
      },
    },
  ),
);

bindLanguageReader(() => useSettingsStore.getState().language);

// Search shortcuts (B4): parsed once per stored value, not on every keystroke.
let shortcutsCache: { raw: string; list: readonly SearchShortcut[] } | null = null;
bindSearchShortcutsReader(() => {
  const raw = useSettingsStore.getState().searchShortcuts;
  if (!shortcutsCache || shortcutsCache.raw !== raw) {
    shortcutsCache = { raw, list: parseSearchShortcuts(raw) };
  }
  return shortcutsCache.list;
});

// Every search URL reads the user's search settings at the moment it is built (B5).
bindSearchSettingsReader(() => {
  const state = useSettingsStore.getState();
  return {
    engine: normalizeSearchEngineId(state.searchEngine),
    safeSearch: normalizeSafeSearch(state.safeSearch),
    language: normalizeSearchLanguage(state.searchLanguage),
    region: normalizeSearchRegion(state.searchRegion),
    appLanguage: state.language,
  };
});

export * from './selectors';
export type { SettingsActions, SettingsKey, SettingsState, SettingsStore } from './types';
