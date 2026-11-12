import { memo, useCallback } from 'react';

import { Switch } from '@/components/inputs/Switch';
import { useTranslation } from '@/localization';
import { selectBackgroundPlayback, useSettingsStore } from '@/store/settings';

import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

export type PlayerSectionProps = {
  disabled?: boolean;
  testID?: string;
};

/** How the player behaves: background play (with a media notification), off by default. */
export const PlayerSection = memo(function PlayerSection({
  disabled = false,
  testID = 'settings-player',
}: PlayerSectionProps) {
  const { t } = useTranslation();
  const backgroundPlayback = useSettingsStore(selectBackgroundPlayback);
  const onValueChange = useCallback((value: boolean) => {
    useSettingsStore.getState().updateSetting('backgroundPlayback', value);
  }, []);

  return (
    <SettingsSection
      testID={testID}
      title={t('settings.playerSection')}
      description={t('settings.playerSectionDescription')}
      icon="play-circle-outline">
      <SettingsRow
        title={t('settings.backgroundPlayback')}
        description={t('settings.backgroundPlaybackHint')}
        icon="headphones"
        trailing={
          <Switch
            value={backgroundPlayback}
            onValueChange={onValueChange}
            disabled={disabled}
            accessibilityLabel={t('settings.backgroundPlayback')}
            accessibilityHint={t('settings.backgroundPlaybackHint')}
            testID="settings-background-playback-switch"
          />
        }
        showDivider={false}
        testID={`${testID}-background-playback`}
      />
    </SettingsSection>
  );
});
