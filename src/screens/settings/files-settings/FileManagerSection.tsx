import { memo, useCallback } from 'react';

import { useTranslation } from '@/localization';
import { push, routePaths } from '@/navigation';
import { SettingsRow } from '@/screens/settings/components/SettingsRow';
import { SettingsSection } from '@/screens/settings/components/SettingsSection';

export type FileManagerSectionProps = {
  disabled?: boolean;
  testID?: string;
};

/** Files F2: Settings → File manager, the main Settings entry for design 27 (as Player → Player settings). */
export const FileManagerSection = memo(function FileManagerSection({ disabled = false, testID = 'settings-file-manager' }: FileManagerSectionProps) {
  const { t } = useTranslation();
  const open = useCallback(() => push(routePaths.filesSettings), []);
  return (
    <SettingsSection
      testID={testID}
      title={t('fileManager.sectionTitle')}
      description={t('fileManager.sectionDescription')}
      icon="folder-cog-outline">
      <SettingsRow
        title={t('fileManager.settingsTitle')}
        description={t('fileManager.settingsSub')}
        icon="folder-cog-outline"
        onPress={disabled ? undefined : open}
        showDivider={false}
        accessibilityHint={t('fileManager.settingsSub')}
        testID={`${testID}-open`}
      />
    </SettingsSection>
  );
});
