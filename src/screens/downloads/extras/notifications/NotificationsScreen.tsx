import { memo, useCallback } from 'react';
import { View } from 'react-native';

import { DsCard, DsHeader, DsIcon, DsProgressBar, DsRow, DsRowGroup, DsScreen, DsSectionLabel, DsText, DsTile, DsTileGrid } from '@/design';
import { useTranslation } from '@/localization';
import { formatTransferSpeed } from '@/screens/downloads/utils/download-format';
import { useDownloadsStore, type DownloadsStore } from '@/store/downloads';
import {
  selectNotificationSilent,
  selectNotificationSound,
  selectNotificationVibrate,
  useSettingsStore,
} from '@/store/settings';

import { fraction, joinDots } from '../shared/format';
import { toast } from '../shared/toast';
import { useNotYet } from '../shared/use-not-yet';
import { useSettingsHeaderAction } from '../shared/use-settings-header-action';

/** The download the progress notification shows: the first one downloading now. */
function activeDownloadId(state: Pick<DownloadsStore, 'orderedIds' | 'itemsById'>): string | null {
  return state.orderedIds.find((id) => state.itemsById[id]?.status === 'DOWNLOADING') ?? null;
}

/**
 * Design 47 "Notifications": a preview of the live progress notification, the home widget (H22 — Android places
 * it from the launcher; the app has no pin call), and the H16 alert options: sound, vibrate, silent mode.
 */
export const NotificationsScreen = memo(function NotificationsScreen() {
  const { t, rtl } = useTranslation();
  const notYet = useNotYet();
  const settingsAction = useSettingsHeaderAction();
  const activeId = useDownloadsStore(activeDownloadId);
  const active = useDownloadsStore((s) => (activeId ? (s.itemsById[activeId] ?? null) : null));
  const transfer = useDownloadsStore((s) => (activeId ? (s.transferById[activeId] ?? null) : null));
  const sound = useSettingsStore(selectNotificationSound);
  const vibrate = useSettingsStore(selectNotificationVibrate);
  const silent = useSettingsStore(selectNotificationSilent);

  const addWidget = useCallback(() => {
    toast(t('lightNotifications.addWidgetFromLauncher'));
  }, [t]);

  const update = useSettingsStore.getState().updateSetting;
  const percent = active ? Math.round(fraction(active.progress) * 100) : null;
  const title = active ? joinDots([t('common.brand'), `${percent}%`]) : t('common.brand');
  const line = active
    ? joinDots([active.title?.trim() || active.fileName?.trim(), formatTransferSpeed(transfer?.bytesPerSecond ?? null)])
    : t('lightNotifications.noActiveDownload');

  return (
    <DsScreen testID="notifications-screen">
      <DsHeader title={t('settings.notifications')} action={settingsAction} />

      <DsCard testID="notifications-preview">
        <View accessible accessibilityLabel={`${t('lightNotifications.previewA11y')}: ${title}, ${line}`}>
          <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 8 }}>
            <DsIcon name="download" size={18} color="textPrimary" strokeWidth={1.8} />
            <DsText variant="cardTitle" numberOfLines={1} style={{ flex: 1 }}>
              {title}
            </DsText>
          </View>
          <DsText variant="body" numberOfLines={1} style={{ marginTop: 4 }} testID="notifications-preview-line">
            {line}
          </DsText>
          <DsProgressBar progress={active ? fraction(active.progress) : 0} style={{ marginTop: 12 }} />
          <View style={{ flexDirection: rtl.rowDirection, justifyContent: 'space-between', marginTop: 8 }}>
            <DsText variant="rowValue">{t('common.pause')}</DsText>
            <DsText variant="rowValue">{t('common.cancel')}</DsText>
          </View>
        </View>
      </DsCard>

      <DsSectionLabel>{t('lightNotifications.homeWidget')}</DsSectionLabel>
      <DsTileGrid testID="notifications-widget-tiles">
        <DsTile icon="download" label={t('lightNotifications.addLink')} onPress={addWidget} testID="notifications-widget-add-link" />
        <DsTile icon="play" label={t('common.continue')} onPress={addWidget} testID="notifications-widget-continue" />
        <DsTile icon="music" label={t('lightNotifications.music')} onPress={addWidget} testID="notifications-widget-music" />
      </DsTileGrid>

      <DsRowGroup testID="notifications-rows">
        <DsRow icon="monitor" title={t('lightNotifications.floatingWidget')} toggle={{ value: false, onValueChange: notYet }} testID="notifications-floating" />
        <DsRow
          icon="volume-2"
          title={t('lightNotifications.sound')}
          subtitle={t('common.default')}
          toggle={{ value: sound && !silent, onValueChange: (value) => update('notificationSound', value) }}
          disabled={silent}
          testID="notifications-sound"
        />
        <DsRow
          icon="smartphone"
          title={t('downloadNotifyOptions.vibrate')}
          toggle={{ value: vibrate && !silent, onValueChange: (value) => update('notificationVibrate', value) }}
          disabled={silent}
          testID="notifications-vibrate"
        />
        <DsRow
          icon="ban"
          title={t('downloadNotifyOptions.silent')}
          toggle={{ value: silent, onValueChange: (value) => update('notificationSilent', value) }}
          testID="notifications-silent"
        />
      </DsRowGroup>
    </DsScreen>
  );
});
