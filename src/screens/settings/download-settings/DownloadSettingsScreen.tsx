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
  selectSaveToGallery,
  selectTapToToggle,
  useSettingsStore,
} from '@/store/settings';

import { AdvancedNetworkSettingsSection } from './AdvancedNetworkSettingsSection';
import { CONCURRENT_SEGMENT_OPTIONS, CONNECTION_SEGMENT_OPTIONS } from './constants';
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

const AFTER_DOWNLOAD_KEYS: Record<AfterDownloadAction, TranslationKey> = {
  none: 'afterDownload.none',
  details: 'afterDownload.details',
  play: 'afterDownload.play',
  gallery: 'afterDownload.gallery',
};

type Sheet = 'saveLocation' | 'network' | 'naming' | 'duplicate' | 'speed' | 'concurrent' | 'connections' | 'subtitleMode' | 'after' | 'liveMax' | null;

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
        <DsRow icon="cpu" title={t('lightDownloadSettings.diskCacheBufferTimeout')} onPress={() => setSheet('network')} testID="download-settings-timeout" />
        <DsRow icon="smartphone" title={t('lightDownloadSettings.lowMemoryMode')} toggle={{ value: false, onValueChange: noop }} testID="download-settings-low-memory" />
      </DsRowGroup>

      <DsSectionLabel>{t('lightDownloadSettings.network')}</DsSectionLabel>
      <DsRowGroup>
        <DsRow icon="globe" title={t('lightDownloadSettings.proxySocksSslIpv6')} onPress={openNetwork} testID="download-settings-proxy" />
        <DsRow icon="shuffle" title={t('lightDownloadSettings.multiNetwork')} toggle={{ value: false, onValueChange: noop }} testID="download-settings-multi-network" />
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
