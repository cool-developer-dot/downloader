import { memo, useCallback, useMemo, useState } from 'react';

import { DsHeader, DsRow, DsRowGroup, DsScreen, DsSectionLabel } from '@/design';
import { AFTER_DOWNLOAD_ACTIONS, type AfterDownloadAction } from '@/downloads/v2/after-download';
import { formatMinuteOfDay, normalizeDownloadHours } from '@/downloads/v2/conditions';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';
import { navigation, routePaths } from '@/navigation';
import { ChoiceSheet } from '@/screens/settings/browser-settings/ChoiceSheet';
import { DownloadHoursSheet } from '@/screens/settings/download-settings/light/DownloadHoursSheet';
import { useDownloadSettingsScreen } from '@/screens/settings/download-settings/useDownloadSettingsScreen';
import {
  selectAfterDownloadAction,
  selectDownloadHours,
  selectNotOnRoaming,
  selectOnlyWhileCharging,
  selectPauseOnLowBattery,
  useSettingsStore,
} from '@/store/settings';

const AFTER_DOWNLOAD_KEYS: Record<AfterDownloadAction, TranslationKey> = {
  none: 'afterDownload.none',
  details: 'afterDownload.details',
  play: 'afterDownload.play',
  gallery: 'afterDownload.gallery',
};

/**
 * Design 13 "Queues & schedule": the queue rows over the existing Queue screen and the download-hours editor, and
 * the SMART RULES card over the F3 conditions (settings store → engine).
 */
export const QueuesScheduleScreen = memo(function QueuesScheduleScreen() {
  const { t } = useTranslation();
  const { settings, setWifiOnly } = useDownloadSettingsScreen();
  const hours = normalizeDownloadHours(useSettingsStore(selectDownloadHours));
  const notOnRoaming = useSettingsStore(selectNotOnRoaming);
  const pauseOnLowBattery = useSettingsStore(selectPauseOnLowBattery);
  const onlyWhileCharging = useSettingsStore(selectOnlyWhileCharging);
  const afterDownload = useSettingsStore(selectAfterDownloadAction);
  // #358: close VidoraX when the queue is empty and the app is in the background.
  const exitWhenDone = useSettingsStore((s) => s.exitWhenDone);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [afterOpen, setAfterOpen] = useState(false);

  const goBack = useCallback(() => navigation.back(), []);
  const openSettings = useCallback(() => navigation.push(routePaths.downloadSettings), []);
  const openQueue = useCallback(() => navigation.push(routePaths.downloadQueue), []);
  const openHours = useCallback(() => setHoursOpen(true), []);
  const closeHours = useCallback(() => setHoursOpen(false), []);

  const afterOptions = useMemo(
    () => AFTER_DOWNLOAD_ACTIONS.map((value) => ({ value, label: t(AFTER_DOWNLOAD_KEYS[value]) })),
    [t],
  );

  return (
    <DsScreen testID="downloads-queues-screen">
      <DsHeader
        title={t('lightQueues.title')}
        onBack={goBack}
        action={{ icon: 'settings', accessibilityLabel: t('lightDetails.settingsA11y'), onPress: openSettings }}
      />
      <DsRowGroup>
        <DsRow
          icon="layers"
          title={t('lightQueues.mainQueue')}
          subtitle={t('lightQueues.maxAtOnce', { count: settings.maxConcurrentDownloads })}
          onPress={openQueue}
          testID="downloads-queues-main"
        />
        <DsRow
          icon="layers"
          title={t('lightQueues.nightQueue')}
          subtitle={hours.enabled ? t('lightQueues.startsAt', { time: formatMinuteOfDay(hours.startMinute) }) : t('common.off')}
          onPress={openHours}
          testID="downloads-queues-night"
        />
        <DsRow icon="clock" title={t('lightQueues.scheduledDownload')} subtitle={t('lightQueues.startStopTime')} onPress={openHours} testID="downloads-queues-scheduled" />
        <DsRow icon="calendar" title={t('lightQueues.weeklySchedule')} onPress={openHours} testID="downloads-queues-weekly" />
      </DsRowGroup>

      <DsSectionLabel>{t('lightQueues.smartRules')}</DsSectionLabel>
      <DsRowGroup>
        <DsRow
          icon="wifi"
          title={t('lightQueues.wifiOnly')}
          toggle={{ value: settings.wifiOnly, onValueChange: (value) => void setWifiOnly(value) }}
          testID="downloads-queues-wifi-only"
        />
        <DsRow
          icon="ban"
          title={t('lightQueues.disableOnRoaming')}
          toggle={{ value: notOnRoaming, onValueChange: (value) => useSettingsStore.getState().updateSetting('notOnRoaming', value) }}
          testID="downloads-queues-roaming"
        />
        <DsRow
          icon="battery-medium"
          title={t('lightQueues.pauseOnLowBattery')}
          toggle={{
            value: pauseOnLowBattery,
            onValueChange: (value) => useSettingsStore.getState().updateSetting('pauseOnLowBattery', value),
          }}
          testID="downloads-queues-low-battery"
        />
        <DsRow
          icon="battery-medium"
          title={t('lightQueues.onlyWhileCharging')}
          toggle={{
            value: onlyWhileCharging,
            onValueChange: (value) => useSettingsStore.getState().updateSetting('onlyWhileCharging', value),
          }}
          testID="downloads-queues-charging"
        />
        <DsRow
          icon="power"
          title={t('lightQueues.exitWhenDone')}
          subtitle={t('downloadTuning.exitWhenDoneHint')}
          toggle={{
            value: exitWhenDone,
            onValueChange: (value) => useSettingsStore.getState().updateSetting('exitWhenDone', value),
            accessibilityHint: t('downloadTuning.exitWhenDoneHint'),
          }}
          testID="downloads-queues-exit"
        />
        <DsRow
          icon="gauge"
          title={t('lightQueues.postDownloadAction')}
          subtitle={t(AFTER_DOWNLOAD_KEYS[afterDownload])}
          onPress={() => setAfterOpen(true)}
          testID="downloads-queues-after"
        />
      </DsRowGroup>

      <DownloadHoursSheet visible={hoursOpen} onClose={closeHours} />
      <ChoiceSheet
        visible={afterOpen}
        title={t('lightQueues.postDownloadAction')}
        options={afterOptions}
        value={afterDownload}
        onSelect={(value) => useSettingsStore.getState().updateSetting('afterDownloadAction', value)}
        onClose={() => setAfterOpen(false)}
        testID="downloads-queues-after-sheet"
      />
    </DsScreen>
  );
});
