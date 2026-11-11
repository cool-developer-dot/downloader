import { memo, useCallback } from 'react';

import { Switch } from '@/components/inputs/Switch';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import { selectClipboardMonitor, useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection, SettingsStaggerItem } from '../components';

/** The route of the Batch Add screen (`src/app/(app)/batch-add.tsx`). */
export const BATCH_ADD_ROUTE = '/batch-add';

/** Download Settings → Adding links: Clipboard Monitor (#291, off by default) and Batch Add (#292). */
export const LinkIntakeSettingsSection = memo(function LinkIntakeSettingsSection({
  index,
  disabled,
}: {
  index: number;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const clipboardMonitor = useSettingsStore(selectClipboardMonitor);
  const openBatch = useCallback(() => navigation.push(BATCH_ADD_ROUTE), []);

  return (
    <SettingsStaggerItem index={index}>
      <SettingsSection
        testID="download-settings-link-intake"
        title={t('linkIntake.section')}
        description={t('linkIntake.sectionDescription')}
        icon="link-variant-plus">
        <SettingsRow
          title={t('linkIntake.clipboardSetting')}
          description={t('linkIntake.clipboardSettingHint')}
          icon="clipboard-text-outline"
          trailing={
            <Switch
              value={clipboardMonitor}
              onValueChange={(value) => useSettingsStore.getState().updateSetting('clipboardMonitor', value)}
              disabled={disabled}
              accessibilityLabel={t('linkIntake.clipboardSetting')}
              accessibilityHint={t('linkIntake.clipboardSettingHint')}
              testID="download-settings-clipboard-monitor-switch"
            />
          }
          testID="download-settings-clipboard-monitor"
        />
        <SettingsRow
          title={t('linkIntake.batchTitle')}
          description={t('linkIntake.batchRowHint')}
          icon="playlist-plus"
          onPress={openBatch}
          showDivider={false}
          testID="download-settings-batch-add"
        />
      </SettingsSection>
    </SettingsStaggerItem>
  );
});
