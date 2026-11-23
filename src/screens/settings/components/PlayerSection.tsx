import { memo, useCallback } from 'react';

import { Switch } from '@/components/inputs/Switch';
import { useTranslation } from '@/localization';
import { setWatchHistoryPaused, useWatchHistoryPaused } from '@/playback/history-pause-preference';
import { selectBackgroundPlayback, useSettingsStore } from '@/store/settings';

import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

export type PlayerSectionProps = {
  disabled?: boolean;
  testID?: string;
};

/**
 * How the player behaves: background play (with a media notification), off by default; P9 #687: Disable History
 * ("Don't save watch history"), off by default.
 */
export const PlayerSection = memo(function PlayerSection({
  disabled = false,
  testID = 'settings-player',
}: PlayerSectionProps) {
  const { t } = useTranslation();
  const backgroundPlayback = useSettingsStore(selectBackgroundPlayback);
  const onValueChange = useCallback((value: boolean) => {
    useSettingsStore.getState().updateSetting('backgroundPlayback', value);
  }, []);
  // P9 #687 Disable History (also ⋮ → Playback in the Player).
  const historyPaused = useWatchHistoryPaused();

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
        testID={`${testID}-background-playback`}
      />
      <SettingsRow
        title={t('libraryStats.disableHistory')}
        description={t('libraryStats.disableHistoryHint')}
        icon="eye-off-outline"
        trailing={
          <Switch
            value={historyPaused}
            onValueChange={setWatchHistoryPaused}
            disabled={disabled}
            accessibilityLabel={t('libraryStats.disableHistory')}
            accessibilityHint={t('libraryStats.disableHistoryHint')}
            testID="settings-disable-history-switch"
          />
        }
        showDivider={false}
        testID={`${testID}-disable-history`}
      />
    </SettingsSection>
  );
});
