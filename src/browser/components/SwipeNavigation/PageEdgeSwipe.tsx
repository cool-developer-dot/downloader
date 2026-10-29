import { memo, type ReactNode } from 'react';
import { View } from 'react-native';
import { GestureDetector, type PanGesture } from 'react-native-gesture-handler';

/**
 * B6 #45: the page's edge swipes (button navigation only; see `useSwipeNavigation`). The gestures watch the whole
 * page but may only start within 24 dp of an edge (`hitSlop`), so nothing covers the page and taps there still reach
 * it.
 */
export const PageEdgeSwipe = memo(function PageEdgeSwipe({
  leftEdge,
  rightEdge,
  children,
}: {
  leftEdge: PanGesture;
  rightEdge: PanGesture;
  children: ReactNode;
}) {
  return (
    <GestureDetector gesture={leftEdge}>
      <View collapsable={false} style={{ flex: 1 }}>
        <GestureDetector gesture={rightEdge}>
          <View collapsable={false} style={{ flex: 1 }}>
            {children}
          </View>
        </GestureDetector>
      </View>
    </GestureDetector>
  );
});
