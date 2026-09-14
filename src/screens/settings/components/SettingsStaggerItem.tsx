import { memo, useEffect, type ReactNode } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { animations } from '@/theme';

export type SettingsStaggerItemProps = {
  index: number;
  children: ReactNode;
  hero?: boolean;
};

/**
 * Subtle staggered entrance — fade + soft upward slide.
 */
export const SettingsStaggerItem = memo(function SettingsStaggerItem({
  index,
  children,
  hero = false,
}: SettingsStaggerItemProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      index * 70,
      withTiming(1, {
        duration: hero ? animations.slow : animations.normal,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [hero, index, progress]);

  const style = useAnimatedStyle(() => {
    const distance = hero ? 14 : 10;
    return {
      opacity: progress.value,
      transform: [{ translateY: (1 - progress.value) * distance }],
    };
  });

  return <Animated.View style={style}>{children}</Animated.View>;
});
