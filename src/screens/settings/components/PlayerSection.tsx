import { memo, useCallback } from 'react';

import { useTranslation } from '@/localization';
import { push, routePaths } from '@/navigation';

import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

export type PlayerSectionProps = {
  disabled?: boolean;
  testID?: string;
};

/**
 * Main Settings entry for Player settings (design 25), like Browser → Browser settings: background play, Disable
 * History (P9 #687) and the Player's other app-wide settings live on that screen.
 */
export const PlayerSection = memo(function PlayerSection({ disabled = false, testID = 'settings-player' }: PlayerSectionProps) {
  const { t } = useTranslation();
  const open = useCallback(() => {
    push(routePaths.playerSettings);
  }, []);

  return (
    <SettingsSection
      testID={testID}
      title={t('settings.playerSection')}
      description={t('settings.playerSectionDescription')}
      icon="play-circle-outline">
      <SettingsRow
        title={t('playerDesign.playerSettings')}
        description={t('playerDesign.settingsRowHint')}
        icon="play-circle-outline"
        onPress={disabled ? undefined : open}
        showDivider={false}
        accessibilityHint={t('playerDesign.settingsRowHint')}
        testID={`${testID}-open`}
      />
    </SettingsSection>
  );
});
