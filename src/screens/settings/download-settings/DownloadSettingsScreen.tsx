import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ToastAndroid } from 'react-native';

import { DsHeader, DsRow, DsRowGroup, DsScreen, DsSectionLabel } from '@/design';
import { AFTER_DOWNLOAD_ACTIONS, type AfterDownloadAction } from '@/downloads/v2/after-download';
import { DUPLICATE_ACTIONS, type DuplicateAction } from '@/downloads/v2/duplicate-action';
import { useDuplicateActionStore } from '@/downloads/v2/duplicate-action-store';
import { maxLengthLabel } from '@/downloads/v2/live-recording';
import { useNetworkOptionsStore } from '@/downloads/v2/network-options-store';
import { useSaveLocationStore } from '@/downloads/v2/save-location-store';
import {
  LIVE_RECORDING_MAX_MINUTES_CHOICES,
  normalizeConnectionsPerFile,
  normalizeLiveRecordingMaxMinutes,
  normalizeLowMemoryMode,
  type LowMemoryMode,
} from '@/downloads/v2/settings';
import { normalizeSpeedLimit, SPEED_LIMIT_CHOICES, speedLimitLabel } from '@/downloads/v2/speed-limit';
import { useSubtitleSettingsStore } from '@/downloads/v2/subtitle-store';
import { SUBTITLE_MODES, type SubtitleMode } from '@/downloads/v2/subtitles';
import { getTreeExportPort } from '@/downloads/v2/tree-export-port';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';
import { navigation, routePaths } from '@/navigation';
import { ChoiceSheet } from '@/screens/settings/browser-settings/ChoiceSheet';
import {
  selectAfterDownloadAction,
  selectClipboardMonitor,
  selectConfirmBeforeStart,
  selectConnectionsPerFile,
  selectDownloadSpeedLimit,
  selectLiveRecording,
  selectLiveRecordingMaxMinutes,
  selectMultiNetwork,
  selectSaveToGallery,
  selectSettingsView,
  selectTapToToggle,
  useSettingsStore,
} from '@/store/settings';
import type { SettingsView } from '@/store/settings/settings-view';
import { useSettingVisible } from '@/screens/settings/components';
import { REMOTE_CONTROL_ROUTE, RemoteControlSettingsSection } from '@/screens/settings/download-settings/RemoteControlSettingsSection';
import { DOWNLOAD_RULES_ROUTE } from '@/screens/download-rules/route';
import { SITE_GRABBER_ROUTE } from '@/screens/site-grabber/route';
import { WATCHED_LINKS_ROUTE } from '@/screens/watched-links/route';
import { multiNetworkForEngine } from '@/downloads/v2/sources';
import { isRemoteControlAvailable } from '@/remote/remote-control';

import { AdvancedNetworkSettingsSection } from './AdvancedNetworkSettingsSection';
import { CloudSettingsSection } from './CloudSettingsSection';
import { CONCURRENT_SEGMENT_OPTIONS, CONNECTION_SEGMENT_OPTIONS } from './constants';
import { DownloadPerformanceSection } from './DownloadPerformanceSection';
import { FilenameSettingsSection } from './FilenameSettingsSection';
import { LightSheet } from './light/LightSheet';
import { useNotAvailableYet } from './light/useNotAvailableYet';
import { SaveLocationSettingsSection } from './SaveLocationSettingsSection';
import { useDownloadSettingsScreen } from './useDownloadSettingsScreen';

const DUPLICATE_KEYS: Record<DuplicateAction, TranslationKey> = {
  skip: 'duplicates.skip',
  ask: 'duplicates.ask',
  keep_both: 'duplicates.keepBoth',
  replace: 'duplicates.replace',
};

const SUBTITLE_MODE_KEYS: Record<SubtitleMode, TranslationKey> = {
  all: 'subtitles.modeAll',
  app_language: 'subtitles.modeAppLanguage',
  first: 'subtitles.modeFirst',
};

const LOW_MEMORY_KEYS: Record<LowMemoryMode, TranslationKey> = {
  auto: 'downloadTuning.lowMemoryAuto',
  on: 'downloadTuning.lowMemoryOn',
  off: 'downloadTuning.lowMemoryOff',
};
const LOW_MEMORY_MODES: readonly LowMemoryMode[] = ['auto', 'on', 'off'];

const SETTINGS_VIEW_KEYS: Record<SettingsView, TranslationKey> = {
  simple: 'settingsView.simple',
  advanced: 'settingsView.advanced',
};

const AFTER_DOWNLOAD_KEYS: Record<AfterDownloadAction, TranslationKey> = {
  none: 'afterDownload.none',
  details: 'afterDownload.details',
  play: 'afterDownload.play',
  gallery: 'afterDownload.gallery',
};

type Sheet =
  | 'saveLocation'
  | 'network'
  | 'naming'
  | 'duplicate'
  | 'speed'
  | 'concurrent'
  | 'connections'
  | 'subtitleMode'
  | 'after'
  | 'liveMax'
  | 'performance'
  | 'lowMemory'
  | 'view'
  | 'cloud'
  | 'remote'
  | null;

/**
 * Design 16 "Download settings": STORAGE · SPEED · NETWORK as the frame draws them, then the rest of the app's
 * download settings (performance, behaviour, notifications, hours & rules, after a download, live recording,
 * advanced network) in the same style. Every setting the old screen had is a row here, a choice sheet, or a sheet
 * holding the old editor (save location, file naming, advanced network).
 */
export const DownloadSettingsScreen = memo(function DownloadSettingsScreen() {
  const { t } = useTranslation();
  const notYet = useNotAvailableYet();
  const {
    settings,
    hydrated,
    feedback,
    notificationEffective,
    setWifiOnly,
    setAutoResume,
    setMaxConcurrent,
    openNotificationSettings,
  } = useDownloadSettingsScreen();

  const saveToGallery = useSettingsStore(selectSaveToGallery);
  const connectionsPerFile = normalizeConnectionsPerFile(useSettingsStore(selectConnectionsPerFile));
  const speedLimit = normalizeSpeedLimit(useSettingsStore(selectDownloadSpeedLimit));
  const confirmBeforeStart = useSettingsStore(selectConfirmBeforeStart);
  const tapToToggle = useSettingsStore(selectTapToToggle);
  const clipboardMonitor = useSettingsStore(selectClipboardMonitor);
  const afterDownload = useSettingsStore(selectAfterDownloadAction);
  const liveRecording = useSettingsStore(selectLiveRecording);
  const liveMax = normalizeLiveRecordingMaxMinutes(useSettingsStore(selectLiveRecordingMaxMinutes));
  const duplicateAction = useDuplicateActionStore((s) => s.action);
  const subtitlesEnabled = useSubtitleSettingsStore((s) => s.enabled);
  const subtitleMode = useSubtitleSettingsStore((s) => s.mode);
  const saveLocationEnabled = useSaveLocationStore((s) => s.enabled);
  const saveLocationFolder = useSaveLocationStore((s) => s.folderName);
  const userAgentMode = useNetworkOptionsStore((s) => s.userAgentMode);
  const lowMemory = normalizeLowMemoryMode(useSettingsStore((s) => s.lowMemoryMode));
  const multiNetwork = useSettingsStore(selectMultiNetwork);
  const settingsView = useSettingsStore(selectSettingsView);
  // P8 #516/#517: Simple hides the rows marked advanced (Advanced shows them all).
  const advancedView = useSettingVisible(true);
  const [sheet, setSheet] = useState<Sheet>(null);
  const closeSheet = useCallback(() => setSheet(null), []);

  // The old screen's banner: an error saving a synced preference is still said.
  useEffect(() => {
    if (feedback?.tone === 'error') {
      ToastAndroid.show(`${feedback.title}. ${feedback.message}`, ToastAndroid.LONG);
    }
  }, [feedback]);

  const goBack = useCallback(() => navigation.back(), []);
  const openAppSettings = useCallback(() => navigation.navigate(routePaths.settings), []);
  const openNetwork = useCallback(() => navigation.push(routePaths.downloadsNetwork), []);
  const openAlerts = useCallback(() => navigation.push(routePaths.downloadsAlerts), []);
  const openQueues = useCallback(() => navigation.push(routePaths.downloadsQueues), []);
  const openStatistics = useCallback(() => navigation.push(routePaths.downloadsStatistics), []);
  const openLiveConvert = useCallback(() => navigation.push(routePaths.downloadsLiveConvert), []);
  const openOrganize = useCallback(() => navigation.push(routePaths.downloadsOrganize), []);
  const openLinkGrabber = useCallback(() => navigation.push(routePaths.downloadsLinkGrabber), []);
  const openFailed = useCallback(() => navigation.push(routePaths.downloadsFailed), []);
  const openNotificationsWidgets = useCallback(() => navigation.push(routePaths.downloadsNotifications), []);
  const openTorrent = useCallback(() => navigation.push(routePaths.downloadsTorrent), []);
  const openBatch = useCallback(() => navigation.push(routePaths.batchAdd), []);
  const openRules = useCallback(() => navigation.push(DOWNLOAD_RULES_ROUTE), []);
  const openWatched = useCallback(() => navigation.push(WATCHED_LINKS_ROUTE), []);
  const openSiteGrabber = useCallback(() => navigation.push(SITE_GRABBER_ROUTE), []);
  const openRemote = useCallback(() => navigation.push(REMOTE_CONTROL_ROUTE), []);
  const openSaveLocation = useCallback(() => {
    if (!getTreeExportPort()) {
      notYet();
      return;
    }
    setSheet('saveLocation');
  }, [notYet]);
  const noop = useCallback(() => notYet(), [notYet]);

  const speedLimitText = useCallback(
    (value: number) => {
      const label = speedLimitLabel(value);
      return label.kind === 'off'
        ? t('settings.speedLimitOff')
        : t(label.kind === 'mb' ? 'settings.speedLimitMb' : 'settings.speedLimitKb', { value: label.value });
    },
    [t],
  );
  const liveMaxText = useCallback((minutes: number) => maxLengthLabel(minutes, t), [t]);

  const duplicateOptions = useMemo(() => DUPLICATE_ACTIONS.map((value) => ({ value, label: t(DUPLICATE_KEYS[value]) })), [t]);
  const speedOptions = useMemo(() => SPEED_LIMIT_CHOICES.map((value) => ({ value: String(value), label: speedLimitText(value) })), [speedLimitText]);
  const concurrentOptions = useMemo(() => CONCURRENT_SEGMENT_OPTIONS.map((option) => ({ value: option.value, label: option.label })), []);
  const connectionOptions = useMemo(() => CONNECTION_SEGMENT_OPTIONS.map((option) => ({ value: option.value, label: option.label })), []);
  const subtitleModeOptions = useMemo(() => SUBTITLE_MODES.map((value) => ({ value, label: t(SUBTITLE_MODE_KEYS[value]) })), [t]);
  const afterOptions = useMemo(() => AFTER_DOWNLOAD_ACTIONS.map((value) => ({ value, label: t(AFTER_DOWNLOAD_KEYS[value]) })), [t]);
  const lowMemoryOptions = useMemo(
    () =>
      LOW_MEMORY_MODES.map((value) => ({
        value,
        label: t(LOW_MEMORY_KEYS[value]),
        description: value === 'auto' ? t('downloadTuning.lowMemoryHint') : undefined,
      })),
    [t],
  );
  const viewOptions = useMemo(
    () => [
      { value: 'simple' as const, label: t('settingsView.simple'), description: t('lightDownloadSettings.simpleHint') },
      { value: 'advanced' as const, label: t('settingsView.advanced'), description: t('lightDownloadSettings.advancedHint') },
    ],
    [t],
  );
  const liveMaxOptions = useMemo(
    () => LIVE_RECORDING_MAX_MINUTES_CHOICES.map((minutes) => ({ value: String(minutes), label: liveMaxText(minutes) })),
    [liveMaxText],
  );

  const showPermissionRequired =
    settings.notificationsEnabled && notificationEffective != null && !notificationEffective.permissionGranted;
  const folderLabel = saveLocationEnabled && saveLocationFolder ? saveLocationFolder : t('filesTab.vidoraxPath');

  return (
    <DsScreen testID="download-settings-screen">
      <DsHeader
        title={t('lightDownloadSettings.title')}
        onBack={goBack}
        action={{ icon: 'settings', accessibilityLabel: t('lightDownloadSettings.appSettingsA11y'), onPress: openAppSettings }}
      />

      <DsSectionLabel first>{t('lightDownloadSettings.storage')}</DsSectionLabel>
      <DsRowGroup>
        <DsRow icon="folder" title={t('lightDownloadSettings.defaultFolder')} subtitle={folderLabel} onPress={openSaveLocation} testID="download-settings-default-folder" />
        <DsRow icon="database" title={t('lightDownloadSettings.sdCardPerTypePerSite')} onPress={openSaveLocation} testID="download-settings-save-location-row" />
        <DsRow icon="alert-triangle" title={t('lightDownloadSettings.askWhereToSave')} toggle={{ value: false, onValueChange: noop }} testID="download-settings-ask-where" />
        <DsRow
          icon="layers"
          title={t('lightDownloadSettings.duplicateAction')}
          subtitle={t(DUPLICATE_KEYS[duplicateAction])}
          onPress={() => setSheet('duplicate')}
          testID="download-settings-duplicate-action"
        />
      </DsRowGroup>

      <DsSectionLabel>{t('lightDownloadSettings.speed')}</DsSectionLabel>
      <DsRowGroup>
        <DsRow icon="gauge" title={t('lightDownloadSettings.speedLimiter')} subtitle={speedLimitText(speedLimit)} onPress={() => setSheet('speed')} testID="download-settings-speed-limit" />
        {advancedView ? (
          <DsRow icon="cpu" title={t('lightDownloadSettings.diskCacheBufferTimeout')} onPress={() => setSheet('performance')} testID="download-settings-timeout" />
        ) : null}
        <DsRow
          icon="smartphone"
          title={t('lightDownloadSettings.lowMemoryMode')}
          subtitle={t(LOW_MEMORY_KEYS[lowMemory])}
          onPress={() => setSheet('lowMemory')}
          testID="download-settings-low-memory"
        />
      </DsRowGroup>

      <DsSectionLabel>{t('lightDownloadSettings.network')}</DsSectionLabel>
      <DsRowGroup>
        <DsRow icon="globe" title={t('lightDownloadSettings.proxySocksSslIpv6')} onPress={openNetwork} testID="download-settings-proxy" />
        {advancedView ? (
          <DsRow
            icon="shuffle"
            title={t('lightDownloadSettings.multiNetwork')}
            subtitle={settings.wifiOnly ? t('downloadSources.multiNetworkWifiOnly') : t('lightDownloadSettings.experimental')}
            toggle={{
              value: multiNetworkForEngine(multiNetwork, settings.wifiOnly),
              onValueChange: (value) => useSettingsStore.getState().updateSetting('multiNetwork', value),
              accessibilityHint: t('downloadSources.multiNetworkHint'),
            }}
            disabled={!hydrated || settings.wifiOnly}
            testID="download-settings-multi-network"
          />
        ) : null}
        <DsRow
          icon="cpu"
          title={t('lightDownloadSettings.userAgent')}
          subtitle={userAgentMode === 'custom' ? t('networkOptions.custom') : t('networkOptions.automatic')}
          onPress={() => setSheet('network')}
          testID="download-settings-user-agent-row"
        />
      </DsRowGroup>

      <DsSectionLabel>{t('lightDownloadSettings.performance')}</DsSectionLabel>
      <DsRowGroup>
        <DsRow
          icon="layers"
          title={t('lightDownloadSettings.maxConcurrent')}
          subtitle={String(settings.maxConcurrentDownloads)}
          onPress={() => setSheet('concurrent')}
          testID="download-settings-max-concurrent"
        />
        <DsRow
          icon="battery-medium"
          title={t('settings.connectionsPerFile')}
          subtitle={String(connectionsPerFile)}
          onPress={() => setSheet('connections')}
          testID="download-settings-connections-per-file"
        />
      </DsRowGroup>

      <DsSectionLabel>{t('lightDownloadSettings.behaviour')}</DsSectionLabel>
      <DsRowGroup>
        <DsRow
          icon="wifi"
          title={t('lightQueues.wifiOnly')}
          toggle={{ value: settings.wifiOnly, onValueChange: (value) => void setWifiOnly(value) }}
          disabled={!hydrated}
          testID="download-settings-wifi-only"
        />
        <DsRow
          icon="refresh-cw"
          title={t('lightDownloadSettings.autoResume')}
          toggle={{ value: settings.autoResume, onValueChange: (value) => void setAutoResume(value) }}
          disabled={!hydrated}
          testID="download-settings-auto-resume"
        />
        <DsRow
          icon="images"
          title={t('settings.saveToGallery')}
          toggle={{ value: saveToGallery, onValueChange: (value) => useSettingsStore.getState().updateSetting('saveToGallery', value) }}
          testID="download-settings-save-to-gallery"
        />
        <DsRow
          icon="languages"
          title={t('lightDownloadSettings.subtitles')}
          toggle={{ value: subtitlesEnabled, onValueChange: (value) => useSubtitleSettingsStore.getState().setEnabled(value) }}
          testID="download-settings-subtitles"
        />
        {subtitlesEnabled ? (
          <DsRow
            icon="languages"
            title={t('lightDownloadSettings.subtitleMode')}
            subtitle={t(SUBTITLE_MODE_KEYS[subtitleMode])}
            onPress={() => setSheet('subtitleMode')}
            testID="download-settings-subtitles-mode"
          />
        ) : null}
        <DsRow
          icon="list-checks"
          title={t('downloadOptions.confirmBeforeStart')}
          toggle={{ value: confirmBeforeStart, onValueChange: (value) => useSettingsStore.getState().updateSetting('confirmBeforeStart', value) }}
          testID="download-settings-confirm-before-start"
        />
        <DsRow
          icon="play"
          title={t('downloadBulk.tapToToggle')}
          toggle={{ value: tapToToggle, onValueChange: (value) => useSettingsStore.getState().updateSetting('tapToToggle', value) }}
          testID="download-settings-tap-to-toggle"
        />
        <DsRow
          icon="clipboard"
          title={t('linkIntake.clipboardSetting')}
          toggle={{ value: clipboardMonitor, onValueChange: (value) => useSettingsStore.getState().updateSetting('clipboardMonitor', value) }}
          testID="download-settings-clipboard-monitor"
        />
        <DsRow icon="list" title={t('linkIntake.batchTitle')} onPress={openBatch} testID="download-settings-batch-add" />
        {advancedView ? (
          <DsRow icon="sliders-horizontal" title={t('bulkAdd.rulesRow')} subtitle={t('lightDownloadSettings.rulesSub')} onPress={openRules} testID="download-settings-download-rules" />
        ) : null}
        <DsRow icon="type" title={t('lightDownloadSettings.fileNaming')} onPress={() => setSheet('naming')} testID="download-settings-file-naming" />
      </DsRowGroup>

      <DsSectionLabel>{t('lightDownloadSettings.notifications')}</DsSectionLabel>
      <DsRowGroup>
        <DsRow icon="bell" title={t('lightAlerts.title')} onPress={openAlerts} testID="download-settings-notifications" />
        {showPermissionRequired ? (
          <DsRow
            icon="bell-off"
            title={t('settings.notificationsPermissionRequired')}
            subtitle={t('settings.notificationsPermissionHint')}
            onPress={() => void openNotificationSettings()}
            accessibilityHint={t('settings.openSystemSettings')}
            testID="download-settings-notifications-permission"
          />
        ) : null}
      </DsRowGroup>

      <DsSectionLabel>{t('lightDownloadSettings.more')}</DsSectionLabel>
      <DsRowGroup>
        <DsRow icon="clock" title={t('lightDownloadSettings.hoursRules')} subtitle={t('lightQueues.title')} onPress={openQueues} testID="download-settings-hours" />
        <DsRow
          icon="gauge"
          title={t('lightDownloadSettings.afterDownload')}
          subtitle={t(AFTER_DOWNLOAD_KEYS[afterDownload])}
          onPress={() => setSheet('after')}
          testID="download-settings-after-download"
        />
        <DsRow
          icon="radio"
          title={t('settings.liveRecording')}
          toggle={{ value: liveRecording, onValueChange: (value) => useSettingsStore.getState().updateSetting('liveRecording', value) }}
          testID="download-settings-live-recording"
        />
        {liveRecording ? (
          <DsRow icon="timer" title={t('settings.liveRecordingMax')} subtitle={liveMaxText(liveMax)} onPress={() => setSheet('liveMax')} testID="download-settings-live-max" />
        ) : null}
        <DsRow icon="network" title={t('networkOptions.section')} onPress={() => setSheet('network')} testID="download-settings-advanced-network-row" />
      </DsRowGroup>

      <DsSectionLabel>{t('lightDownloadSettings.integrations')}</DsSectionLabel>
      <DsRowGroup>
        <DsRow icon="refresh-cw" title={t('watchedLinks.row')} subtitle={t('watchedLinks.rowHint')} onPress={openWatched} testID="download-settings-watched-links" />
        <DsRow icon="globe" title={t('siteGrabber.row')} subtitle={t('siteGrabber.rowHint')} onPress={openSiteGrabber} testID="download-settings-site-grabber" />
        <DsRow icon="cloud" title={t('cloud.section')} subtitle={t('lightDownloadSettings.cloudSub')} onPress={() => setSheet('cloud')} testID="download-settings-cloud" />
        {isRemoteControlAvailable() ? (
          <DsRow
            icon="monitor"
            title={t('remoteControl.section')}
            subtitle={t('lightDownloadSettings.remoteSub')}
            onPress={advancedView ? () => setSheet('remote') : openRemote}
            testID="download-settings-remote"
          />
        ) : null}
      </DsRowGroup>

      <DsSectionLabel>{t('lightDownloadSettings.mode')}</DsSectionLabel>
      <DsRowGroup>
        <DsRow
          icon="sliders-vertical"
          title={t('settingsView.label')}
          subtitle={t(SETTINGS_VIEW_KEYS[settingsView])}
          onPress={() => setSheet('view')}
          testID="download-settings-view-mode"
        />
      </DsRowGroup>

      {/* The design's remaining Downloads screens (15, 41–47, 14), reachable from here. */}
      <DsSectionLabel>{t('lightDownloadSettings.tools')}</DsSectionLabel>
      <DsRowGroup>
        <DsRow icon="gauge" title={t('lightDownloadSettings.statistics')} onPress={openStatistics} testID="download-settings-statistics" />
        <DsRow icon="radio" title={t('lightLiveConvert.title')} onPress={openLiveConvert} testID="download-settings-live-convert" />
        <DsRow icon="folder" title={t('lightOrganize.title')} subtitle={t('lightOrganize.subtitle')} onPress={openOrganize} testID="download-settings-organize" />
        <DsRow icon="link" title={t('lightLinkGrabber.title')} subtitle={t('lightLinkGrabber.subtitle')} onPress={openLinkGrabber} testID="download-settings-link-grabber" />
        <DsRow icon="alert-triangle" title={t('lightDownloadSettings.failedRetry')} onPress={openFailed} testID="download-settings-failed" />
        <DsRow icon="bell" title={t('lightDownloadSettings.notificationsWidgets')} onPress={openNotificationsWidgets} testID="download-settings-notifications-widgets" />
        <DsRow icon="layers" title={t('lightDownloadSettings.torrent')} onPress={openTorrent} testID="download-settings-torrent" />
      </DsRowGroup>

      <LightSheet visible={sheet === 'saveLocation'} title={t('saveLocation.section')} onClose={closeSheet} testID="download-settings-save-location-sheet">
        <SaveLocationSettingsSection index={0} disabled={!hydrated} />
      </LightSheet>
      <LightSheet visible={sheet === 'network'} title={t('networkOptions.section')} onClose={closeSheet} testID="download-settings-network-sheet">
        <AdvancedNetworkSettingsSection index={0} disabled={!hydrated} />
      </LightSheet>
      <LightSheet visible={sheet === 'performance'} title={t('downloadTuning.section')} onClose={closeSheet} testID="download-settings-performance-sheet">
        <DownloadPerformanceSection disabled={!hydrated} />
      </LightSheet>
      <LightSheet visible={sheet === 'cloud'} title={t('cloud.section')} onClose={closeSheet} testID="download-settings-cloud-sheet">
        <CloudSettingsSection index={0} disabled={!hydrated} />
      </LightSheet>
      <LightSheet visible={sheet === 'remote'} title={t('remoteControl.section')} onClose={closeSheet} testID="download-settings-remote-sheet">
        <RemoteControlSettingsSection index={0} disabled={!hydrated} />
      </LightSheet>
      <LightSheet visible={sheet === 'naming'} title={t('lightDownloadSettings.fileNaming')} onClose={closeSheet} testID="download-settings-naming-sheet">
        <FilenameSettingsSection index={0} disabled={!hydrated} />
      </LightSheet>

      <ChoiceSheet
        visible={sheet === 'duplicate'}
        title={t('duplicates.settingTitle')}
        options={duplicateOptions}
        value={duplicateAction}
        onSelect={(value) => useDuplicateActionStore.getState().setAction(value)}
        onClose={closeSheet}
        testID="download-settings-duplicate-sheet"
      />
      <ChoiceSheet
        visible={sheet === 'speed'}
        title={t('lightDownloadSettings.speedLimiter')}
        options={speedOptions}
        value={String(speedLimit)}
        onSelect={(value) => useSettingsStore.getState().updateSetting('downloadSpeedLimit', normalizeSpeedLimit(value))}
        onClose={closeSheet}
        testID="download-settings-speed-sheet"
      />
      <ChoiceSheet
        visible={sheet === 'concurrent'}
        title={t('lightDownloadSettings.maxConcurrent')}
        options={concurrentOptions}
        value={String(settings.maxConcurrentDownloads)}
        onSelect={(value) => void setMaxConcurrent(Number(value))}
        onClose={closeSheet}
        testID="download-settings-concurrent-sheet"
      />
      <ChoiceSheet
        visible={sheet === 'connections'}
        title={t('settings.connectionsPerFile')}
        options={connectionOptions}
        value={String(connectionsPerFile)}
        onSelect={(value) => useSettingsStore.getState().updateSetting('connectionsPerFile', Number(value))}
        onClose={closeSheet}
        testID="download-settings-connections-sheet"
      />
      <ChoiceSheet
        visible={sheet === 'subtitleMode'}
        title={t('lightDownloadSettings.subtitleMode')}
        options={subtitleModeOptions}
        value={subtitleMode}
        onSelect={(value) => useSubtitleSettingsStore.getState().setMode(value)}
        onClose={closeSheet}
        testID="download-settings-subtitle-mode-sheet"
      />
      <ChoiceSheet
        visible={sheet === 'after'}
        title={t('lightDownloadSettings.afterDownload')}
        options={afterOptions}
        value={afterDownload}
        onSelect={(value) => useSettingsStore.getState().updateSetting('afterDownloadAction', value)}
        onClose={closeSheet}
        testID="download-settings-after-sheet"
      />
      <ChoiceSheet
        visible={sheet === 'lowMemory'}
        title={t('lightDownloadSettings.lowMemoryMode')}
        options={lowMemoryOptions}
        value={lowMemory}
        onSelect={(value) => useSettingsStore.getState().updateSetting('lowMemoryMode', value)}
        onClose={closeSheet}
        testID="download-settings-low-memory-sheet"
      />
      <ChoiceSheet
        visible={sheet === 'view'}
        title={t('settingsView.label')}
        options={viewOptions}
        value={settingsView}
        onSelect={(value) => useSettingsStore.getState().updateSetting('settingsView', value)}
        onClose={closeSheet}
        testID="download-settings-view-sheet"
      />
      <ChoiceSheet
        visible={sheet === 'liveMax'}
        title={t('settings.liveRecordingMax')}
        options={liveMaxOptions}
        value={String(liveMax)}
        onSelect={(value) => useSettingsStore.getState().updateSetting('liveRecordingMaxMinutes', normalizeLiveRecordingMaxMinutes(value))}
        onClose={closeSheet}
        testID="download-settings-live-max-sheet"
      />
    </DsScreen>
  );
});
