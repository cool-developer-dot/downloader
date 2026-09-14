import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { withAlpha } from '@/theme';

import { useOnboardingSurfaces } from '../../onboarding-surfaces-context';

import type { HeroIconAnim } from './useHeroEcosystemSequence';
import { HERO_ECOSYSTEM_LAYOUT, type HeroOrbitItem } from './constants';

type HeroIconProps = {
  item: HeroOrbitItem;
  x: number;
  y: number;
  center: number;
  anim: HeroIconAnim;
  focusOpacity: SharedValue<number>;
};

const HALF = HERO_ECOSYSTEM_LAYOUT.containerSize / 2;

export const HeroIcon = memo(function HeroIcon({
  item,
  x,
  y,
  center,
  anim,
  focusOpacity,
}: HeroIconProps) {
  const surfaces = useOnboardingSurfaces();
  const { Icon, label, color, border, kind } = item;
  const isDownload = item.id === 'download';
  const iconColor = isDownload ? surfaces.accent : color;
  const borderColor = isDownload ? withAlpha(surfaces.accent, 0.28) : border;

  const style = useAnimatedStyle(() => ({
    opacity: anim.opacity.value * focusOpacity.value,
    transform: [
      { translateX: x - HALF + anim.enterX.value + anim.floatX.value },
      { translateY: y - HALF + anim.enterY.value + anim.floatY.value },
      { scale: anim.scale.value },
    ],
  }));

  return (
    <Animated.View
      style={[styles.container, { left: center, top: center }, style]}
      accessibilityLabel={label}
      accessible>
      <View
        style={[
          styles.glass,
          {
            backgroundColor: surfaces.heroGlassBg,
            borderColor,
          },
        ]}>
        <Icon
          size={HERO_ECOSYSTEM_LAYOUT.iconSize}
          color={iconColor}
          strokeWidth={kind === 'capability' ? HERO_ECOSYSTEM_LAYOUT.iconStroke : undefined}
        />
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    width: HERO_ECOSYSTEM_LAYOUT.containerSize,
    height: HERO_ECOSYSTEM_LAYOUT.containerSize,
    zIndex: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glass: {
    width: HERO_ECOSYSTEM_LAYOUT.containerSize,
    height: HERO_ECOSYSTEM_LAYOUT.containerSize,
    borderRadius: HALF,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth + 0.5,
  },
});
