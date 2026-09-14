import { memo, useCallback } from 'react';

import { push, routePaths } from '@/navigation';
import { useTranslation } from '@/localization';
import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

export type DownloadsSectionProps = {
  testID?: string;
};

/**
 * Main Settings entry — navigates to dedicated Download Settings.
 * Keeps the primary Settings screen uncluttered (Week 7 Day 1 Phase 2).
 */
export const DownloadsSection = memo(function DownloadsSection({
  testID = 'settings-downloads',
}: DownloadsSectionProps) {
  const { t } = useTranslation();
  const openDownloadSettings = useCallback(() => {
    push(routePaths.downloadSettings);
  }, []);

  return (
    <SettingsSection
      testID={testID}
      title={t('settings.downloadsSection')}
      description={t('settings.downloadsDescription')}
      icon="download-outline">
      <SettingsRow
        title={t('settings.downloadSettings')}
        description={t('settings.downloadSettingsHint')}
        icon="download-outline"
        onPress={openDownloadSettings}
        showDivider={false}
        accessibilityHint={t('settings.downloadSettingsHint')}
        testID={`${testID}-open`}
      />
    </SettingsSection>
  );
});
