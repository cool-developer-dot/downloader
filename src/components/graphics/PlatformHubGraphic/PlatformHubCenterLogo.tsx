import { Image } from 'expo-image';
import { memo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { BRAND_LOGO_SIZES, VIDORAX_LOGO } from '@/constants/brand-assets';
import { useTranslation } from '@/localization';

import { PLATFORM_HUB_LAYOUT } from './usePlatformHubLayout';
import { usePlatformHubTokens } from './usePlatformHubTokens';

export type PlatformHubCenterLogoProps = {
  variant?: 'hero' | 'compact';
  animatedOpacity?: SharedValue<number>;
  animatedScale?: SharedValue<number>;
  animatedTranslateY?: SharedValue<number>;
  animatedGlow?: SharedValue<number>;
  animatedBreath?: SharedValue<number>;
  children?: ReactNode;
};

/**
 * Premium center mark — soft sage glow, rounded icon crop, no white backing plate.
 */
export const PlatformHubCenterLogo = memo(function PlatformHubCenterLogo({
  variant = 'hero',
  animatedOpacity,
  animatedScale,
  animatedTranslateY,
  animatedGlow,
  animatedBreath,
  children,
}: PlatformHubCenterLogoProps) {
  const { t } = useTranslation();
  const tokens = usePlatformHubTokens(variant);
  const spec = PLATFORM_HUB_LAYOUT[variant];
  const logoSize = variant === 'hero' ? BRAND_LOGO_SIZES.md : BRAND_LOGO_SIZES.sm + 8;
  const cornerRadius = logoSize * 0.22;

  const logoStyle = useAnimatedStyle(() => {
    if (!animatedOpacity && !animatedScale && !animatedTranslateY && !animatedBreath) {
      return {};
    }

    return {
      opacity: animatedOpacity?.value ?? 1,
      transform: [
        { translateY: animatedTranslateY?.value ?? 0 },
        { scale: (animatedScale?.value ?? 1) * (animatedBreath?.value ?? 1) },
      ],
    };
  });

  const glowStyle = useAnimatedStyle(() => {
    if (!animatedGlow) {
      return { opacity: 0.55 };
    }

    const glow = Math.min(animatedGlow.value, 1.4);
    return {
      opacity: Math.min(glow, 1) * 0.95,
      transform: [{ scale: 0.9 + Math.min(glow, 1.4) * 0.12 }],
    };
  });

  const mark = children ?? (
    <Image
      source={VIDORAX_LOGO}
      style={{ width: logoSize, height: logoSize, borderRadius: cornerRadius }}
      contentFit="cover"
      cachePolicy="memory-disk"
      recyclingKey="vidorax-platform-hub-logo"
      accessibilityLabel={t('common.logoA11y')}
      accessible
    />
  );

  const content = animatedOpacity || animatedScale || animatedTranslateY || animatedBreath ? (
    <Animated.View style={logoStyle}>{mark}</Animated.View>
  ) : (
    mark
  );

  return (
    <View
      style={[styles.wrap, { width: spec.centerGlow, height: spec.centerGlow }]}
      accessibilityLabel={t('common.logoA11y')}
      accessible>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glowOuter,
          {
            width: spec.centerGlow,
            height: spec.centerGlow,
            borderRadius: spec.centerGlow / 2,
            backgroundColor: tokens.centerGlowOuter,
          },
          glowStyle,
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glowInner,
          {
            width: spec.centerSize + 12,
            height: spec.centerSize + 12,
            borderRadius: (spec.centerSize + 12) / 2,
            backgroundColor: tokens.centerGlowInner,
          },
          glowStyle,
        ]}
      />
      <View
        style={[
          styles.ring,
          {
            width: logoSize + 8,
            height: logoSize + 8,
            borderRadius: cornerRadius + 4,
            borderColor: tokens.centerRing,
          },
        ]}
      />
      <View
        style={[
          styles.logoClip,
          {
            width: logoSize,
            height: logoSize,
            borderRadius: cornerRadius,
          },
        ]}>
        {content}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
  },
  glowOuter: {
    position: 'absolute',
  },
  glowInner: {
    position: 'absolute',
  },
  ring: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth + 0.5,
    backgroundColor: 'transparent',
  },
  logoClip: {
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
});
