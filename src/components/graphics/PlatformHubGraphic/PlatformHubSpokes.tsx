import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { usePlatformHubTokens } from './usePlatformHubTokens';
import type { PlatformHubOrbitPosition } from './types';

type PlatformHubSpokesProps = {
  size: number;
  center: number;
  positions: PlatformHubOrbitPosition[];
};

/** Subtle static spokes — always-visible network guides beneath animated pulses. */
export const PlatformHubSpokes = memo(function PlatformHubSpokes({
  size,
  center,
  positions,
}: PlatformHubSpokesProps) {
  const tokens = usePlatformHubTokens();

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wrap]}>
      <Svg width={size} height={size}>
        {positions.map((pos) => (
          <Line
            key={`spoke-${pos.item.id}`}
            x1={center}
            y1={center}
            x2={center + pos.x}
            y2={center + pos.y}
            stroke={tokens.beam}
            strokeWidth={0.75}
            strokeOpacity={0.35}
          />
        ))}
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    zIndex: 0,
  },
});
