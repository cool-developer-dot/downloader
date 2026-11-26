import { memo } from 'react';

import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { SettingsRow } from '@/screens/settings/components/SettingsRow';
import { SettingsSection } from '@/screens/settings/components/SettingsSection';

/**
 * Settings → Start & backup. Files F11 moved its rows (Default tab, Settings backup, Back up all data, Restore, Reset)
 * onto the Backup page of design 62; this section opens it.
 */
export const BackupResetSection = memo(function BackupResetSection({
  testID = 'settings-backup-reset',
}: {
  testID?: string;
}) {
  const { t } = useTranslation();
  return (
    <SettingsSection
      testID={testID}
      title={t('settingsBackup.section')}
      description={t('settingsBackup.sectionDescription')}
      icon="cog-sync-outline">
      <SettingsRow
        title={t('fileManager.backupRow')}
        description={t('fileManager.backupRowHint')}
        icon="database-export-outline"
        onPress={() => navigation.push(routePaths.backup)}
        showDivider={false}
        testID={`${testID}-open`}
      />
    </SettingsSection>
  );
});
