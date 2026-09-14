import { memo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import type { PlayerSideGestureKind } from '@/player/use-player-side-gestures';

export type PlayerAdjustmentHudProps = {
  type: PlayerSideGestureKind | null;
  percent: number;
  visible: boolean;
};

function brightnessIcon(percent: number): string {
  if (percent <= 25) {
    return 'brightness-5';
  }
  if (percent <= 70) {
    return 'brightness-6';
  }
  return 'brightness-7';
}

function volumeIcon(percent: number): string {
  if (percent <= 0) {
    return 'volume-off';
  }
  if (percent <= 35) {
    return 'volume-low';
  }
  if (percent <= 70) {
    return 'volume-medium';
  }
  return 'volume-high';
}

/**
 * Compact temporary brightness/volume HUD — visible only during side gestures.
 * Fixed dark scrim over video pixels (intentional media overlay — not theme chrome).
 */
export const PlayerAdjustmentHud = memo(function PlayerAdjustmentHud({
  type,
  percent,
  visible,
}: PlayerAdjustmentHudProps) {
  if (!visible || !type) {
    return null;
  }

  const iconName = type === 'brightness' ? brightnessIcon(percent) : volumeIcon(percent);
  const label =
    type === 'brightness'
      ? `Brightness ${percent} percent`
      : `Volume ${percent} percent`;

  return (
    <Animated.View
      entering={FadeIn.duration(140)}
      exiting={FadeOut.duration(220)}
      pointerEvents="none"
      style={[
        styles.wrap,
        type === 'brightness' ? styles.left : styles.right,
      ]}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}>
      <Animated.View style={styles.card}>
        <Icon name={iconName} size={28} color="inverse" />
        <Text variant="title" color="white" style={styles.percent}>
          {percent}%
        </Text>
      </Animated.View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: '32%',
    zIndex: 6,
  },
  left: {
    left: '18%',
    alignItems: 'center',
  },
  right: {
    right: '18%',
    alignItems: 'center',
  },
  card: {
    minWidth: 88,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    gap: 6,
    // Intentional fixed video HUD scrim — readable over arbitrary video frames.
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 6,
  },
  percent: {
    fontVariant: ['tabular-nums'],
  },
});
