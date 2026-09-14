import { memo, useCallback } from 'react';

import { push, routePaths } from '@/navigation';
import { useTranslation } from '@/localization';

import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

export type StorageSectionProps = {
  testID?: string;
};

/**
 * Settings → Storage: Manage Storage opens the Storage Manager screen.
 */
export const StorageSection = memo(function StorageSection({
  testID = 'settings-storage',
}: StorageSectionProps) {
  const { t } = useTranslation();

  const openStorage = useCallback(() => {
    push(routePaths.storage);
  }, []);

  return (
    <SettingsSection
      testID={testID}
      title={t('settings.storageSection')}
      description={t('settings.storageSectionDescription')}
      icon="harddisk">
      <SettingsRow
        title={t('settings.manageStorage')}
        description={t('settings.manageStorageHint')}
        icon="folder-cog-outline"
        onPress={openStorage}
        showDivider={false}
        accessibilityHint={t('settings.manageStorageA11y')}
        testID={`${testID}-manage`}
      />
    </SettingsSection>
  );
});
