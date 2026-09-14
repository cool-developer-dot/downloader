import { memo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';

import { PLATFORM_HUB_CONNECTION } from './animations';
import { usePlatformHubTokens } from './usePlatformHubTokens';

type PlatformHubConnectionProps = {
  x: number;
  y: number;
  distance: number;
  center: number;
  progress: SharedValue<number>;
};

/** One-shot pulse from platform node toward the center logo. */
export const PlatformHubConnection = memo(function PlatformHubConnection({
  x,
  y,
  distance,
  center,
  progress,
}: PlatformHubConnectionProps) {
  const tokens = usePlatformHubTokens();

  const beamStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const length = distance * Math.min(Math.max(p, 0), 1);
    const midX = x * (1 - p / 2);
    const midY = y * (1 - p / 2);
    const angle = Math.atan2(-y, -x);

    return {
      width: Math.max(length, 0.01),
      opacity: interpolate(p, [0, 0.1, 0.75, 1], [0, 0.38, 0.18, 0.06], Extrapolation.CLAMP),
      transform: [
        { translateX: midX - length / 2 },
        { translateY: midY - PLATFORM_HUB_CONNECTION.connectionHeight / 2 },
        { rotate: `${angle}rad` },
      ],
    };
  });

  const energyStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: interpolate(p, [0, 0.06, 0.82, 1], [0, 1, 0.85, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: x * (1 - p) - PLATFORM_HUB_CONNECTION.energySize / 2 },
        { translateY: y * (1 - p) - PLATFORM_HUB_CONNECTION.energySize / 2 },
        {
          scale: interpolate(p, [0, 0.45, 1], [0.65, 1.12, 0.55], Extrapolation.CLAMP),
        },
      ],
    };
  });

  const origin = { left: center, top: center };

  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[styles.beam, { backgroundColor: tokens.beam }, origin, beamStyle]}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.energy, { backgroundColor: tokens.energy }, origin, energyStyle]}
      />
    </>
  );
});

const styles = StyleSheet.create({
  beam: {
    position: 'absolute',
    height: PLATFORM_HUB_CONNECTION.connectionHeight,
    borderRadius: PLATFORM_HUB_CONNECTION.connectionHeight,
    zIndex: 1,
  },
  energy: {
    position: 'absolute',
    width: PLATFORM_HUB_CONNECTION.energySize,
    height: PLATFORM_HUB_CONNECTION.energySize,
    borderRadius: PLATFORM_HUB_CONNECTION.energySize / 2,
    zIndex: 2,
  },
});
