import { memo } from 'react';
import { View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { PlatformHubCenterLogo } from '@/components/graphics';

import { useOnboardingSurfaces } from '../../onboarding-surfaces-context';
import { gatewayStyles } from '../styles/gateway.styles';

type GatewayLogoProps = {
  opacity: SharedValue<number>;
  scale: SharedValue<number>;
  translateY: SharedValue<number>;
  glow: SharedValue<number>;
  breath: SharedValue<number>;
};

/** Gateway hero mark — delegates to the shared platform hub center logo. */
export const GatewayLogo = memo(function GatewayLogo({
  opacity,
  scale,
  translateY,
  glow,
  breath,
}: GatewayLogoProps) {
  const surfaces = useOnboardingSurfaces();

  const glowStyle = useAnimatedStyle(() => {
    const value = Math.min(glow.value, 1.4);
    return {
      opacity: Math.min(value, 1) * 0.95,
      transform: [{ scale: 0.9 + Math.min(value, 1.4) * 0.12 }],
    };
  });

  return (
    <View style={gatewayStyles.logoWrap}>
      <Animated.View
        pointerEvents="none"
        style={[
          gatewayStyles.logoGlow,
          { backgroundColor: surfaces.logoGlow },
          glowStyle,
        ]}
      />
      <PlatformHubCenterLogo
        variant="hero"
        animatedOpacity={opacity}
        animatedScale={scale}
        animatedTranslateY={translateY}
        animatedGlow={glow}
        animatedBreath={breath}
      />
    </View>
  );
});
