import { memo, useCallback, useMemo, useState } from 'react';
import { Linking } from 'react-native';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';

import { DsChip, DsChipRow, DsHeader, DsRow, DsRowGroup, DsScreen, DsSectionLabel } from '@/design';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { isRemoteControlAvailable } from '@/remote/remote-control';
import { useQueueBackup } from '@/screens/download-history/useQueueBackup';
import { CloudSettingsSection } from '@/screens/settings/download-settings/CloudSettingsSection';
import { LightSheet } from '@/screens/settings/download-settings/light/LightSheet';
import { useNotAvailableYet } from '@/screens/settings/download-settings/light/useNotAvailableYet';
import { REMOTE_CONTROL_ROUTE } from '@/screens/settings/download-settings/RemoteControlSettingsSection';
import { useDownloadSettingsScreen } from '@/screens/settings/download-settings/useDownloadSettingsScreen';
import {
  selectNotificationSilent,
  selectNotificationSound,
  selectNotificationVibrate,
  selectSettingsView,
  useSettingsStore,
} from '@/store/settings';

/**
 * Design 17 "Alerts & sync": the download notification toggle (with its OS permission), sound & vibrate (H16's
 * notification options), the widgets, battery exemption (Android's own list), CLOUD — the queue to another phone
 * (#510), send to the computer (#511), the user's cloud app (#512/#513/#507) — and MODE, the Settings view
 * (#516/#517: Beginner = Simple). The floating widget is not part of this release.
 */
export const AlertsSyncScreen = memo(function AlertsSyncScreen() {
  const { t } = useTranslation();
  const notYet = useNotAvailableYet();
  const { settings, notificationEffective, setNotifications, openNotificationSettings } = useDownloadSettingsScreen();
  const sound = useSettingsStore(selectNotificationSound);
  const vibrate = useSettingsStore(selectNotificationVibrate);
  const silent = useSettingsStore(selectNotificationSilent);
  const settingsView = useSettingsStore(selectSettingsView);
  const backup = useQueueBackup();
  const [syncSheet, setSyncSheet] = useState(false);
  const [cloudSheet, setCloudSheet] = useState(false);

  const goBack = useCallback(() => navigation.back(), []);
  const openSettings = useCallback(() => navigation.push(routePaths.downloadSettings), []);
  const openWidgets = useCallback(() => navigation.push(routePaths.downloadsNotifications), []);
  const noop = useCallback(() => notYet(), [notYet]);

  const showPermissionRequired =
    settings.notificationsEnabled && notificationEffective != null && !notificationEffective.permissionGranted;

  const setSoundVibrate = useCallback((value: boolean) => {
    const update = useSettingsStore.getState().updateSetting;
    update('notificationSound', value);
    update('notificationVibrate', value);
    if (value) {
      update('notificationSilent', false);
    }
  }, []);

  const chooseMode = useCallback((next: 'simple' | 'advanced') => {
    useSettingsStore.getState().updateSetting('settingsView', next);
  }, []);

  // Android's own "Battery optimization" list: VidoraX never asks for the restricted exemption permission.
  const openBatterySettings = useCallback(() => {
    void Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS').catch(() => {
      void Linking.openSettings().catch(() => notYet());
    });
  }, [notYet]);

  const openSendToDevice = useCallback(() => (isRemoteControlAvailable() ? navigation.push(REMOTE_CONTROL_ROUTE) : notYet()), [notYet]);

  const syncActions = useMemo<ActionSheetItem[]>(() => {
    const items: ActionSheetItem[] = [];
    if (backup.canSendQueue) {
      items.push({
        id: 'send',
        label: t('queueBackup.send'),
        icon: 'cellphone-arrow-down',
        onPress: () => {
          setSyncSheet(false);
          if (backup.exportCount > 0 && !backup.busy) backup.sendQueue();
        },
      });
    }
    items.push({
      id: 'import',
      label: t('queueBackup.import'),
      icon: 'import',
      onPress: () => {
        setSyncSheet(false);
        if (!backup.busy) backup.importQueue();
      },
    });
    return items;
  }, [backup, t]);

  return (
    <DsScreen testID="downloads-alerts-screen">
      <DsHeader
        title={t('lightAlerts.title')}
        onBack={goBack}
        action={{ icon: 'settings', accessibilityLabel: t('lightDetails.settingsA11y'), onPress: openSettings }}
      />
      <DsRowGroup>
        <DsRow
          icon="bell"
          title={t('lightAlerts.progressNotifications')}
          toggle={{ value: settings.notificationsEnabled, onValueChange: (value) => void setNotifications(value) }}
          testID="downloads-alerts-notifications"
        />
        {showPermissionRequired ? (
          <DsRow
            icon="bell-off"
            title={t('settings.notificationsPermissionRequired')}
            subtitle={t('settings.notificationsPermissionHint')}
            onPress={() => void openNotificationSettings()}
            accessibilityHint={t('settings.openSystemSettings')}
            testID="downloads-alerts-permission"
          />
        ) : null}
        <DsRow
          icon="volume-2"
          title={t('lightAlerts.soundVibrate')}
          toggle={{ value: (sound || vibrate) && !silent, onValueChange: setSoundVibrate }}
          testID="downloads-alerts-sound"
        />
        <DsRow icon="monitor" title={t('lightAlerts.floatingWidget')} toggle={{ value: false, onValueChange: noop }} testID="downloads-alerts-floating" />
        <DsRow icon="folder" title={t('lightAlerts.homeWidget')} onPress={openWidgets} testID="downloads-alerts-home-widget" />
        <DsRow
          icon="battery-medium"
          title={t('lightAlerts.batteryExemption')}
          subtitle={t('lightAlerts.batteryExemptionSub')}
          onPress={openBatterySettings}
          testID="downloads-alerts-battery"
        />
      </DsRowGroup>

      <DsSectionLabel>{t('lightAlerts.cloud')}</DsSectionLabel>
      <DsRowGroup>
        <DsRow
          icon="cloud"
          title={t('lightAlerts.crossDeviceSync')}
          subtitle={backup.exportCount > 0 ? t('queueBackup.exportHint', { count: backup.exportCount }) : t('lightAlerts.crossDeviceSyncSub')}
          onPress={() => setSyncSheet(true)}
          testID="downloads-alerts-sync"
        />
        <DsRow icon="smartphone" title={t('lightAlerts.sendToDevice')} subtitle={t('lightAlerts.sendToDeviceSub')} onPress={openSendToDevice} testID="downloads-alerts-send" />
        <DsRow icon="upload" title={t('lightAlerts.saveToCloud')} subtitle={t('lightDownloadSettings.cloudSub')} onPress={() => setCloudSheet(true)} testID="downloads-alerts-cloud-save" />
      </DsRowGroup>

      <DsSectionLabel>{t('lightAlerts.mode')}</DsSectionLabel>
      <DsChipRow scroll={false}>
        <DsChip label={t('lightAlerts.beginner')} selected={settingsView === 'simple'} onPress={() => chooseMode('simple')} testID="downloads-alerts-mode-beginner" />
        <DsChip label={t('lightAlerts.advanced')} selected={settingsView === 'advanced'} onPress={() => chooseMode('advanced')} testID="downloads-alerts-mode-advanced" />
      </DsChipRow>

      <ActionSheetModal
        visible={syncSheet}
        onClose={() => setSyncSheet(false)}
        title={t('lightAlerts.crossDeviceSync')}
        subtitle={backup.exportCount > 0 ? t('queueBackup.exportHint', { count: backup.exportCount }) : t('queueBackup.exportNothing')}
        actions={syncActions}
        testID="downloads-alerts-sync-sheet"
      />
      <LightSheet visible={cloudSheet} title={t('cloud.section')} onClose={() => setCloudSheet(false)} testID="downloads-alerts-cloud-sheet">
        <CloudSettingsSection index={0} />
      </LightSheet>
    </DsScreen>
  );
});
