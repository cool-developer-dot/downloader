import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { usePlatformHubTokens } from './usePlatformHubTokens';

type PlatformHubRadialGuideProps = {
  size: number;
  orbitRadius: number;
};

export const PlatformHubRadialGuide = memo(function PlatformHubRadialGuide({
  size,
  orbitRadius,
}: PlatformHubRadialGuideProps) {
  const tokens = usePlatformHubTokens();
  const center = size / 2;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.wrap]}>
      <Svg width={size} height={size}>
        <Circle
          cx={center}
          cy={center}
          r={orbitRadius}
          stroke={tokens.radialGuide}
          strokeWidth={1}
          fill="none"
        />
        <Circle
          cx={center}
          cy={center}
          r={orbitRadius * 0.62}
          stroke={tokens.radialGuideOuter}
          strokeWidth={1}
          fill="none"
        />
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    zIndex: 0,
  },
});
