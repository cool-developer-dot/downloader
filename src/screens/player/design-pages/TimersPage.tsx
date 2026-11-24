import { memo } from 'react';

import { DsRow } from '@/design';
import { useTranslation } from '@/localization';
import { setHeadsetKeySettings, useHeadsetKeySettings } from '@/player/engine/headset-keys';
import type { PlayerOptionContext } from '@/player/options';

import { PlayerDesignPage } from './PlayerDesignPage';
import { PlayerOptionRows } from './PlayerOptionRows';

export type TimersPageProps = {
  visible: boolean;
  context: PlayerOptionContext;
  onBack: () => void;
  onSettings: () => void;
};

/**
 * Design 51: P18's sleep timer, daily limit and Kid Lock, a bookmark of this moment (P9), and P15's headset switches.
 * Its Music alarm, Set as ringtone and Audio cutter are features the owner set as Not planned.
 */
export const TimersPage = memo(function TimersPage({ visible, context, onBack, onSettings }: TimersPageProps) {
  const { t } = useTranslation();
  const keys = useHeadsetKeySettings();
  return (
    <PlayerDesignPage
      visible={visible}
      title={t('playerDesign.timersTitle')}
      subtitle={t('playerDesign.timersSub')}
      onBack={onBack}
      onSettings={onSettings}
      testID="player-timers-page">
      <PlayerOptionRows
        context={context}
        ids={['p18.sleepTimer', 'p18.dailyLimit', 'p18.kidLock', 'p9.addBookmark']}
        titles={{ 'p9.addBookmark': 'playerDesign.rowBookmarkNow' }}
        onClosePage={onBack}>
        <DsRow
          icon="headphones"
          title={t('playerDesign.rowHeadsetButtons')}
          subtitle={t('playerEngine.keysHeadsetSub')}
          toggle={{ value: keys.headsetButtons, onValueChange: (on) => setHeadsetKeySettings({ headsetButtons: on }) }}
          testID="player-timers-headset"
        />
        <DsRow
          icon="headphones"
          title={t('playerDesign.rowHeadphoneDetection')}
          subtitle={t('playerDesign.rowHeadphoneDetectionSub')}
          toggle={{ value: keys.pauseOnUnplug, onValueChange: (on) => setHeadsetKeySettings({ pauseOnUnplug: on }) }}
          testID="player-timers-unplug"
        />
      </PlayerOptionRows>
    </PlayerDesignPage>
  );
});
