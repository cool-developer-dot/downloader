import { memo } from 'react';

import { Switch } from '@/components/inputs/Switch';
import { useTranslation } from '@/localization';
import { selectConfirmBeforeStart, useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection, SettingsStaggerItem } from '../components';

/** Download Settings → Before a download starts: Confirm Before Start (#479), off by default. */
export const BeforeDownloadSettingsSection = memo(function BeforeDownloadSettingsSection({
  index,
  disabled,
}: {
  index: number;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const confirmBeforeStart = useSettingsStore(selectConfirmBeforeStart);

  return (
    <SettingsStaggerItem index={index}>
      <SettingsSection
        testID="download-settings-before-download"
        title={t('downloadOptions.settingsSection')}
        description={t('downloadOptions.settingsSectionDescription')}
        icon="tune-variant">
        <SettingsRow
          title={t('downloadOptions.confirmBeforeStart')}
          description={t('downloadOptions.confirmBeforeStartHint')}
          icon="clipboard-check-outline"
          trailing={
            <Switch
              value={confirmBeforeStart}
              onValueChange={(value) => useSettingsStore.getState().updateSetting('confirmBeforeStart', value)}
              disabled={disabled}
              accessibilityLabel={t('downloadOptions.confirmBeforeStart')}
              accessibilityHint={t('downloadOptions.confirmBeforeStartHint')}
              testID="download-settings-confirm-before-start-switch"
            />
          }
          showDivider={false}
          testID="download-settings-confirm-before-start"
        />
      </SettingsSection>
    </SettingsStaggerItem>
  );
});
