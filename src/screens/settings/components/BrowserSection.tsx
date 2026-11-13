import { memo, useCallback } from 'react';

import { push, routePaths } from '@/navigation';
import { useTranslation } from '@/localization';

import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

/** Main Settings entry for Browser settings (B5 onward), like Downloads → Download Settings. */
export const BrowserSection = memo(function BrowserSection({ testID = 'settings-browser' }: { testID?: string }) {
  const { t } = useTranslation();
  const open = useCallback(() => {
    push(routePaths.browserSettings);
  }, []);

  return (
    <SettingsSection
      testID={testID}
      title={t('browserSettings.settingsSection')}
      description={t('browserSettings.settingsSectionDescription')}
      icon="web">
      <SettingsRow
        title={t('browserSettings.settingsRow')}
        description={t('browserSettings.settingsRowHint')}
        icon="web"
        onPress={open}
        showDivider={false}
        accessibilityHint={t('browserSettings.settingsRowHint')}
        testID={`${testID}-open`}
      />
    </SettingsSection>
  );
});
