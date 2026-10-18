import { memo } from 'react';

import { Switch } from '@/components/inputs/Switch';
import { useTranslation } from '@/localization';
import { selectTapToToggle, useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection, SettingsStaggerItem } from '../components';

export type DownloadListSettingsSectionProps = {
  index: number;
  disabled?: boolean;
};

/** Download Settings → Downloads list: Tap to Toggle (#335), off by default. */
export const DownloadListSettingsSection = memo(function DownloadListSettingsSection({
  index,
  disabled,
}: DownloadListSettingsSectionProps) {
  const { t } = useTranslation();
  const tapToToggle = useSettingsStore(selectTapToToggle);

  return (
    <SettingsStaggerItem index={index}>
      <SettingsSection
        testID="download-settings-list"
        title={t('downloadBulk.listSection')}
        description={t('downloadBulk.listSectionDescription')}
        icon="gesture-tap">
        <SettingsRow
          title={t('downloadBulk.tapToToggle')}
          description={t('downloadBulk.tapToToggleHint')}
          icon="play-pause"
          trailing={
            <Switch
              value={tapToToggle}
              onValueChange={(value) => {
                useSettingsStore.getState().updateSetting('tapToToggle', value);
              }}
              disabled={disabled}
              accessibilityLabel={t('downloadBulk.tapToToggle')}
              accessibilityHint={t('downloadBulk.tapToToggleHint')}
              testID="download-settings-tap-to-toggle-switch"
            />
          }
          showDivider={false}
          accessibilityHint={t('downloadBulk.tapToToggleHint')}
          testID="download-settings-tap-to-toggle"
        />
      </SettingsSection>
    </SettingsStaggerItem>
  );
});
