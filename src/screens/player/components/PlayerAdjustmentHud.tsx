import { memo, useSyncExternalStore } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { useTranslation } from '@/localization';
import type { AdjustmentHud, AdjustmentHudKind } from '@/player/adjustment-hud';

export type PlayerAdjustmentHudProps = {
  hud: AdjustmentHud;
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

function iconFor(kind: AdjustmentHudKind, percent: number): string {
  switch (kind) {
    case 'brightness':
      return brightnessIcon(percent);
    case 'volume':
      return volumeIcon(percent);
    case 'zoom':
    default:
      return 'magnify-plus-outline';
  }
}

/**
 * Compact temporary brightness / volume / zoom indicator — visible only while a gesture changes a value and briefly
 * after. Subscribes to the gesture's store itself, so a swipe re-renders this card alone. Never takes a touch.
 * Fixed dark scrim over video pixels (intentional media overlay — not theme chrome).
 */
export const PlayerAdjustmentHud = memo(function PlayerAdjustmentHud({ hud }: PlayerAdjustmentHudProps) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(hud.subscribe, hud.getSnapshot, hud.getSnapshot);
  if (!state.visible || !state.kind) {
    return null;
  }
  const { kind, percent } = state;
  const label =
    kind === 'brightness'
      ? t('player.hud.brightness', { percent })
      : kind === 'volume'
        ? t('player.hud.volume', { percent })
        : t('player.hud.zoom', { percent });

  return (
    <Animated.View
      entering={FadeIn.duration(90)}
      exiting={FadeOut.duration(100)}
      pointerEvents="none"
      style={[
        styles.wrap,
        kind === 'brightness' ? styles.left : kind === 'volume' ? styles.right : styles.center,
      ]}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}>
      <Animated.View style={styles.card}>
        <Icon name={iconFor(kind, percent)} size={28} color="inverse" />
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
  center: {
    left: 0,
    right: 0,
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
