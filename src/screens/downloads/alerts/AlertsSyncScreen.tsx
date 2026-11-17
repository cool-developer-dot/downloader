import { memo, useCallback, useState } from 'react';

import { DsChip, DsChipRow, DsHeader, DsRow, DsRowGroup, DsScreen, DsSectionLabel } from '@/design';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useNotAvailableYet } from '@/screens/settings/download-settings/light/useNotAvailableYet';
import { useDownloadSettingsScreen } from '@/screens/settings/download-settings/useDownloadSettingsScreen';
import {
  selectNotificationSilent,
  selectNotificationSound,
  selectNotificationVibrate,
  useSettingsStore,
} from '@/store/settings';

/**
 * Design 17 "Alerts & sync": the download notification toggle (with its OS permission), sound & vibrate (H16's
 * notification options), the widgets, and the CLOUD and MODE blocks the app has no feature for yet.
 */
export const AlertsSyncScreen = memo(function AlertsSyncScreen() {
  const { t } = useTranslation();
  const notYet = useNotAvailableYet();
  const { settings, notificationEffective, setNotifications, openNotificationSettings } = useDownloadSettingsScreen();
  const sound = useSettingsStore(selectNotificationSound);
  const vibrate = useSettingsStore(selectNotificationVibrate);
  const silent = useSettingsStore(selectNotificationSilent);
  // No beginner / advanced setting exists in the app yet: the chips keep their own state and say so.
  const [mode, setMode] = useState<'beginner' | 'advanced'>('beginner');

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

  const chooseMode = useCallback(
    (next: 'beginner' | 'advanced') => {
      setMode(next);
      notYet();
    },
    [notYet],
  );

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
        <DsRow icon="battery-medium" title={t('lightAlerts.batteryExemption')} onPress={notYet} testID="downloads-alerts-battery" />
      </DsRowGroup>

      <DsSectionLabel>{t('lightAlerts.cloud')}</DsSectionLabel>
      <DsRowGroup>
        <DsRow icon="cloud" title={t('lightAlerts.crossDeviceSync')} toggle={{ value: false, onValueChange: noop }} testID="downloads-alerts-sync" />
        <DsRow icon="smartphone" title={t('lightAlerts.sendToDevice')} onPress={notYet} testID="downloads-alerts-send" />
        <DsRow icon="upload" title={t('lightAlerts.saveToCloud')} onPress={notYet} testID="downloads-alerts-cloud-save" />
      </DsRowGroup>

      <DsSectionLabel>{t('lightAlerts.mode')}</DsSectionLabel>
      <DsChipRow scroll={false}>
        <DsChip label={t('lightAlerts.beginner')} selected={mode === 'beginner'} onPress={() => chooseMode('beginner')} testID="downloads-alerts-mode-beginner" />
        <DsChip label={t('lightAlerts.advanced')} selected={mode === 'advanced'} onPress={() => chooseMode('advanced')} testID="downloads-alerts-mode-advanced" />
      </DsChipRow>
    </DsScreen>
  );
});
