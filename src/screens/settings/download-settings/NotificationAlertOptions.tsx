import { memo } from 'react';

import { Divider } from '@/components/common/Divider';
import { Switch } from '@/components/inputs/Switch';
import { useTranslation } from '@/localization';
import {
  selectNotificationSilent,
  selectNotificationSound,
  selectNotificationVibrate,
  useSettingsStore,
} from '@/store/settings';

import { SettingsRow } from '../components';

export type NotificationAlertOptionsProps = {
  disabled?: boolean;
};

/**
 * Notification Sound (#452), Vibrate (#453), Silent Mode (#457) for finished and failed downloads. The defaults
 * (sound on, vibration off, not silent) are today's behaviour. Silent overrides the other two, so they are disabled
 * while it is on. The engine receives them with the download settings (v2/settings.ts).
 */
export const NotificationAlertOptions = memo(function NotificationAlertOptions({
  disabled,
}: NotificationAlertOptionsProps) {
  const { t } = useTranslation();
  const sound = useSettingsStore(selectNotificationSound);
  const vibrate = useSettingsStore(selectNotificationVibrate);
  const silent = useSettingsStore(selectNotificationSilent);
  const update = useSettingsStore.getState().updateSetting;

  return (
    <>
      <Divider />
      <SettingsRow
        title={t('downloadNotifyOptions.sound')}
        description={t('downloadNotifyOptions.soundHint')}
        icon="volume-high"
        trailing={
          <Switch
            value={sound && !silent}
            onValueChange={(value) => update('notificationSound', value)}
            disabled={disabled || silent}
            accessibilityLabel={t('downloadNotifyOptions.sound')}
            accessibilityHint={t('downloadNotifyOptions.soundHint')}
            testID="download-settings-notification-sound-switch"
          />
        }
        accessibilityHint={t('downloadNotifyOptions.soundHint')}
        testID="download-settings-notification-sound"
      />
      <SettingsRow
        title={t('downloadNotifyOptions.vibrate')}
        description={t('downloadNotifyOptions.vibrateHint')}
        icon="vibrate"
        trailing={
          <Switch
            value={vibrate && !silent}
            onValueChange={(value) => update('notificationVibrate', value)}
            disabled={disabled || silent}
            accessibilityLabel={t('downloadNotifyOptions.vibrate')}
            accessibilityHint={t('downloadNotifyOptions.vibrateHint')}
            testID="download-settings-notification-vibrate-switch"
          />
        }
        accessibilityHint={t('downloadNotifyOptions.vibrateHint')}
        testID="download-settings-notification-vibrate"
      />
      <SettingsRow
        title={t('downloadNotifyOptions.silent')}
        description={t('downloadNotifyOptions.silentHint')}
        icon="bell-sleep-outline"
        trailing={
          <Switch
            value={silent}
            onValueChange={(value) => update('notificationSilent', value)}
            disabled={disabled}
            accessibilityLabel={t('downloadNotifyOptions.silent')}
            accessibilityHint={t('downloadNotifyOptions.silentHint')}
            testID="download-settings-notification-silent-switch"
          />
        }
        showDivider={false}
        accessibilityHint={t('downloadNotifyOptions.silentHint')}
        testID="download-settings-notification-silent"
      />
    </>
  );
});
