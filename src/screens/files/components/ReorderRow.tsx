import { memo, useMemo, useState, type ReactElement } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { DsIcon } from '@/design';
import { useRtl, useTranslation } from '@/localization';

export type ReorderRowProps = {
  name: string;
  /** Moves the row by whole rows: -2 is two up, 1 is one down. */
  onMoveBy: (steps: number) => void;
  /** While the handle is held (the list stops scrolling). */
  onDragChange?: (dragging: boolean) => void;
  children: ReactElement;
  testID?: string;
};

/**
 * Files F7 · #954 Drag reorder: a row of a folder's Custom order with a drag handle at its start. Dragging the handle
 * moves the row, and letting go puts it that many rows up or down (gesture-handler + reanimated, as F4's drag select).
 * TalkBack gets Move up / Move down on the handle, so dragging is never the only way.
 */
export const ReorderRow = memo(function ReorderRow({ name, onMoveBy, onDragChange, children, testID }: ReorderRowProps) {
  const rtl = useRtl();
  const { t } = useTranslation();
  const [height, setHeight] = useState(58);
  const offset = useSharedValue(0);
  const lifted = useSharedValue(false);

  const gesture = useMemo(
    () =>
      // The handle takes the touch at once, so the row's long press (F4's drag select) never starts from the handle.
      Gesture.Pan()
        .manualActivation(true)
        .onTouchesDown((_event, manager) => {
          manager.activate();
        })
        .onStart(() => {
          lifted.set(true);
          if (onDragChange) runOnJS(onDragChange)(true);
        })
        .onUpdate((event) => {
          offset.set(event.translationY);
        })
        .onEnd((event) => {
          const steps = Math.round(event.translationY / Math.max(1, height));
          if (steps !== 0) runOnJS(onMoveBy)(steps);
        })
        .onFinalize(() => {
          lifted.set(false);
          offset.set(withTiming(0, { duration: 120 }));
          if (onDragChange) runOnJS(onDragChange)(false);
        }),
    [height, lifted, offset, onDragChange, onMoveBy],
  );

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
    zIndex: lifted.value ? 10 : 0,
    elevation: lifted.value ? 6 : 0,
  }));

  return (
    <Animated.View style={style} onLayout={(event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height)} testID={testID}>
      <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center' }}>
        <GestureDetector gesture={gesture}>
          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={t('fileManager.dragToMove', { name })}
            accessibilityActions={[
              { name: 'increment', label: t('fileManager.moveDown') },
              { name: 'decrement', label: t('fileManager.moveUp') },
            ]}
            onAccessibilityAction={(event) => onMoveBy(event.nativeEvent.actionName === 'decrement' ? -1 : 1)}
            style={{ width: 28, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' }}
            testID={testID ? `${testID}-handle` : undefined}>
            <DsIcon name="grip-vertical" size={18} color="textSecondary" strokeWidth={1.8} />
          </View>
        </GestureDetector>
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    </Animated.View>
  );
});
