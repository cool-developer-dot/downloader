import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { useTranslation } from '@/localization';
import { fontFamilies } from '@/theme/typography';

import { useOnboardingSurfaces } from '../../onboarding-surfaces-context';
import { LIBRARY_LAYOUT } from '../constants';

type OfflinePlayerCardProps = {
  waveform: SharedValue<number>;
};

const WAVE_FACTORS = [0.5, 0.95, 0.65, 1, 0.55] as const;

/**
 * Compact “Playing Offline” readout with a tiny waveform.
 */
export const OfflinePlayerCard = memo(function OfflinePlayerCard({
  waveform,
}: OfflinePlayerCardProps) {
  const { t } = useTranslation();
  const surfaces = useOnboardingSurfaces();

  return (
    <View style={styles.row} pointerEvents="none">
      <Text
        style={[
          styles.label,
          { fontFamily: fontFamilies.bodySemiBold, color: surfaces.accent },
        ]}
        maxFontSizeMultiplier={LIBRARY_LAYOUT.maxFontMultiplier}
        numberOfLines={1}>
        {t('onboarding.libraryPlaying')}
      </Text>
      <View style={styles.waveRow}>
        {WAVE_FACTORS.map((factor, index) => (
          <WaveBar
            key={index}
            factor={factor}
            waveform={waveform}
            phase={index * 0.12}
            color={surfaces.waveform}
          />
        ))}
      </View>
    </View>
  );
});

const WaveBar = memo(function WaveBar({
  factor,
  waveform,
  phase,
  color,
}: {
  factor: number;
  waveform: SharedValue<number>;
  phase: number;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    const base = waveform.value;
    const pulsed = Math.min(1, Math.max(0.3, base + (base - 0.5) * phase));
    return {
      transform: [{ scaleY: pulsed * factor }],
    };
  });

  return <Animated.View style={[styles.bar, { backgroundColor: color }, style]} />;
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 10,
    letterSpacing: 0.2,
  },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 12,
  },
  bar: {
    width: 2,
    height: 12,
    borderRadius: 1,
  },
});
