import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { PLATFORM_HUB_LAYOUT } from './usePlatformHubLayout';
import { usePlatformHubTokens } from './usePlatformHubTokens';
import type { PlatformHubIconAnim, PlatformHubItem } from './types';

type PlatformHubIconNodeProps = {
  item: PlatformHubItem;
  x: number;
  y: number;
  center: number;
  variant: 'hero' | 'compact';
  anim?: PlatformHubIconAnim;
  focusOpacity?: SharedValue<number>;
};

export const PlatformHubIconNode = memo(function PlatformHubIconNode({
  item,
  x,
  y,
  center,
  variant,
  anim,
  focusOpacity,
}: PlatformHubIconNodeProps) {
  const tokens = usePlatformHubTokens(variant);
  const spec = PLATFORM_HUB_LAYOUT[variant];
  const half = spec.nodeSize / 2;
  const { Icon, label, brandColor, kind } = item;

  const style = useAnimatedStyle(() => {
    if (!anim) {
      return {
        transform: [{ translateX: x - half }, { translateY: y - half }],
      };
    }

    const focus = focusOpacity?.value ?? 1;
    return {
      opacity: anim.opacity.value * focus,
      transform: [
        { translateX: x - half + anim.enterX.value + anim.floatX.value },
        { translateY: y - half + anim.enterY.value + anim.floatY.value },
        { scale: anim.scale.value },
      ],
    };
  });

  const iconColor = kind === 'platform' ? brandColor : tokens.capabilityIcon;

  const node = (
    <View
      style={[
        styles.node,
        {
          width: spec.nodeSize,
          height: spec.nodeSize,
          borderRadius: half,
          backgroundColor: tokens.nodeBg,
          borderColor: kind === 'capability' ? tokens.nodeBorderCapability : tokens.nodeBorder,
        },
      ]}>
      <Icon
        size={spec.iconSize}
        color={iconColor}
        strokeWidth={spec.iconStroke}
      />
    </View>
  );

  return (
    <Animated.View
      style={[styles.container, { left: center, top: center }, style]}
      accessibilityLabel={label}
      accessible>
      {node}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  node: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth + 0.5,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },
});
