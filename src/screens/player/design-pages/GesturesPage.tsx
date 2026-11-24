import { memo } from 'react';
import { View } from 'react-native';

import { DsCard, DsIcon, DsText } from '@/design';
import { useTranslation } from '@/localization';
import type { PlayerOptionContext } from '@/player/options';

import { PlayerDesignPage } from './PlayerDesignPage';
import { PlayerOptionRows } from './PlayerOptionRows';

export type GesturesPageProps = {
  visible: boolean;
  context: PlayerOptionContext;
  onBack: () => void;
  onSettings: () => void;
};

/** Design 20: the gesture map, then P8's gesture rows, P19's volume boost and P15's keys. */
export const GesturesPage = memo(function GesturesPage({ visible, context, onBack, onSettings }: GesturesPageProps) {
  const { t } = useTranslation();
  return (
    <PlayerDesignPage
      visible={visible}
      title={t('playerDesign.gesturesTitle')}
      subtitle={t('playerDesign.gesturesSub')}
      onBack={onBack}
      onSettings={onSettings}
      testID="player-gestures-page">
      <DsCard>
        <View style={{ alignItems: 'center', gap: 4, paddingVertical: 6 }} accessible accessibilityRole="text">
          <View style={{ flexDirection: 'row', gap: 14, marginBottom: 6 }} importantForAccessibility="no-hide-descendants">
            <DsIcon name="sun" size={20} color="textPrimary" />
            <DsIcon name="arrow-left" size={20} color="textPrimary" />
            <DsIcon name="chevron-right" size={20} color="textPrimary" />
            <DsIcon name="volume-2" size={20} color="textPrimary" />
          </View>
          <DsText variant="rowSub" color="textPrimary" align="center">
            {t('playerDesign.gestureLine1')}
          </DsText>
          <DsText variant="rowSub" color="textPrimary" align="center">
            {t('playerDesign.gestureLine2')}
          </DsText>
          <DsText variant="rowSub" color="textPrimary" align="center">
            {t('playerDesign.gestureLine3')}
          </DsText>
        </View>
      </DsCard>
      <PlayerOptionRows
        context={context}
        ids={['p8.gestureControls', 'p8.gestureSensitivity', 'p8.gestures', 'p19.volumeBoost', 'p15.headsetKeys', 'p8.customizeControls']}
        titles={{ 'p15.headsetKeys': 'playerDesign.rowHardwareKeys' }}
        onClosePage={onBack}
      />
    </PlayerDesignPage>
  );
});
