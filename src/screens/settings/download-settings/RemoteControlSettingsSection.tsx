import { memo, useCallback, useEffect } from 'react';

import { Switch } from '@/components/inputs/Switch';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import {
  isRemoteControlAvailable,
  refreshRemoteState,
  setAllowOtherApps,
  useRemoteStore,
} from '@/remote/remote-control';

import { SettingsRow, SettingsSection, SettingsStaggerItem } from '../components';

/** The route of the Remote control screen (`src/app/(app)/remote-control.tsx`). */
export const REMOTE_CONTROL_ROUTE = '/remote-control';

/** P6 Download Settings → Remote control (#439, #438) and "Allow other apps to control downloads" (#499). */
export const RemoteControlSettingsSection = memo(function RemoteControlSettingsSection({
  index,
  disabled,
}: {
  index: number;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const status = useRemoteStore((state) => state.status);
  const allowOtherApps = useRemoteStore((state) => state.allowOtherApps);
  const open = useCallback(() => navigation.push(REMOTE_CONTROL_ROUTE), []);

  useEffect(() => {
    void refreshRemoteState().catch(() => undefined);
  }, []);

  if (!isRemoteControlAvailable()) {
    return null;
  }

  return (
    <SettingsStaggerItem index={index}>
      <SettingsSection
        testID="download-settings-remote"
        title={t('remoteControl.section')}
        description={t('remoteControl.sectionDescription')}
        icon="monitor-cellphone">
        <SettingsRow
          title={t('remoteControl.rowTitle')}
          description={
            status.running && status.url
              ? t('remoteControl.rowHintOn', { url: status.url })
              : t('remoteControl.rowHintOff')
          }
          icon="access-point"
          onPress={open}
          testID="download-settings-remote-control"
        />
        <SettingsRow
          title={t('remoteControl.allowApps')}
          description={t('remoteControl.allowAppsHint')}
          icon="robot-outline"
          trailing={
            <Switch
              value={allowOtherApps}
              onValueChange={(value) => void setAllowOtherApps(value)}
              disabled={disabled}
              accessibilityLabel={t('remoteControl.allowApps')}
              accessibilityHint={t('remoteControl.allowAppsHint')}
              testID="download-settings-allow-other-apps-switch"
            />
          }
          showDivider={false}
          testID="download-settings-allow-other-apps"
        />
      </SettingsSection>
    </SettingsStaggerItem>
  );
});
