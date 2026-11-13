import { memo, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { addressBarVisibility } from '@/browser/address-bar/address-bar-visibility';

const SLIDE_MS = 160;

/**
 * B4 #29 — slides the browser header out while Auto-hide hides it, and back in. The page is resized once per hide
 * or show (the wrapper collapses after the slide out, and opens before the slide in), never every frame, so
 * scrolling and the WebView's layout stay smooth. With the bar at the bottom it slides down instead of up.
 */
export const AutoHideHeader = memo(function AutoHideHeader({
  position,
  children,
}: {
  position: 'top' | 'bottom';
  children: ReactNode;
}) {
  const hidden = useSyncExternalStore(addressBarVisibility.subscribe, addressBarVisibility.isHidden);
  const [height, setHeight] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (hidden) {
      progress.value = withTiming(1, { duration: SLIDE_MS }, (finished) => {
        if (finished) runOnJS(setCollapsed)(true);
      });
    } else {
      setCollapsed(false);
      progress.value = withTiming(0, { duration: SLIDE_MS });
    }
  }, [hidden, progress]);

  const sign = position === 'top' ? -1 : 1;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: progress.value * height * sign }],
  }));

  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height);
    if (next > 0 && next !== height) setHeight(next);
  };

  return (
    <View
      style={{ height: collapsed ? 0 : undefined, overflow: 'hidden', zIndex: 2 }}
      importantForAccessibility={collapsed ? 'no-hide-descendants' : 'auto'}>
      <Animated.View onLayout={onLayout} style={style}>
        {children}
      </Animated.View>
    </View>
  );
});
