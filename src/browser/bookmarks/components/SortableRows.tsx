import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * B9 #80 — a list whose rows can be dragged to a new place (B1's tab-list pattern, generalised): hold a row, then move
 * it; rows of one height so positions are index × height. Each row says which slots it may move to (`range` — folders
 * stay among folders, bookmarks among bookmarks). A hold without moving opens the row's options. Rows also offer
 * Move up / Move down as TalkBack actions (in the row component), so dragging is never the only way.
 */

const LIFT_AFTER_MS = 380;
const AUTO_SCROLL_EDGE = 72;
const AUTO_SCROLL_STEP = 9;
const MOVE_SLOP = 10;

type Positions = Record<string, number>;

function indexMap(ids: readonly string[]): Positions {
  const map: Positions = {};
  ids.forEach((id, index) => {
    map[id] = index;
  });
  return map;
}

function moveInMap(map: Positions, id: string, target: number): Positions {
  'worklet';
  const ids = Object.keys(map).sort((a, b) => map[a]! - map[b]!);
  const from = ids.indexOf(id);
  if (from < 0) return map;
  ids.splice(from, 1);
  ids.splice(target, 0, id);
  const next: Positions = {};
  for (let i = 0; i < ids.length; i += 1) next[ids[i]!] = i;
  return next;
}

export type SortableRowsProps<T extends { id: string }> = {
  items: readonly T[];
  rowHeight: number;
  /** Whether dragging is on (off in search results). */
  dragEnabled: boolean;
  range: (item: T, index: number) => [number, number];
  renderRow: (item: T, index: number) => ReactNode;
  onMove: (id: string, toIndex: number) => void;
  onHold: (id: string) => void;
  header?: ReactNode;
  headerHeight?: number;
  testID?: string;
};

function SortableRowsBase<T extends { id: string }>({
  items,
  rowHeight,
  dragEnabled,
  range,
  renderRow,
  onMove,
  onHold,
  header,
  headerHeight = 0,
  testID,
}: SortableRowsProps<T>) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const positions = useSharedValue<Positions>(indexMap(ids));
  const scrollY = useSharedValue(0);
  const viewportHeight = useSharedValue(0);
  const contentHeight = useSharedValue(items.length * rowHeight + headerHeight);
  const autoScroll = useSharedValue(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    positions.set(indexMap(ids));
    contentHeight.set(ids.length * rowHeight + headerHeight);
  }, [contentHeight, headerHeight, ids, positions, rowHeight]);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });

  useFrameCallback(() => {
    if (autoScroll.value === 0) return;
    const max = Math.max(0, contentHeight.value - viewportHeight.value);
    const next = Math.min(max, Math.max(0, scrollY.value + autoScroll.value * AUTO_SCROLL_STEP));
    if (next !== scrollY.value) {
      scrollTo(scrollRef, 0, next, false);
      scrollY.set(next);
    }
  });

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewportHeight.set(event.nativeEvent.layout.height);
    },
    [viewportHeight],
  );

  return (
    <Animated.ScrollView
      ref={scrollRef}
      testID={testID}
      style={{ flex: 1 }}
      onScroll={onScroll}
      scrollEventThrottle={16}
      scrollEnabled={!dragging}
      onLayout={handleLayout}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 24 }}>
      {header}
      <Animated.View style={{ height: items.length * rowHeight }}>
        {items.map((item, index) => (
          <SortableRow
            key={item.id}
            id={item.id}
            index={index}
            rowHeight={rowHeight}
            headerHeight={headerHeight}
            dragEnabled={dragEnabled}
            range={range(item, index)}
            positions={positions}
            scrollY={scrollY}
            viewportHeight={viewportHeight}
            autoScroll={autoScroll}
            onDragChange={setDragging}
            onMove={onMove}
            onHold={onHold}>
            {renderRow(item, index)}
          </SortableRow>
        ))}
      </Animated.View>
    </Animated.ScrollView>
  );
}

export const SortableRows = memo(SortableRowsBase) as typeof SortableRowsBase;

const SortableRow = memo(function SortableRow({
  id,
  index,
  rowHeight,
  headerHeight,
  dragEnabled,
  range,
  positions,
  scrollY,
  viewportHeight,
  autoScroll,
  onDragChange,
  onMove,
  onHold,
  children,
}: {
  id: string;
  index: number;
  rowHeight: number;
  headerHeight: number;
  dragEnabled: boolean;
  range: [number, number];
  positions: SharedValue<Positions>;
  scrollY: SharedValue<number>;
  viewportHeight: SharedValue<number>;
  autoScroll: SharedValue<number>;
  onDragChange: (dragging: boolean) => void;
  onMove: (id: string, toIndex: number) => void;
  onHold: (id: string) => void;
  children: ReactNode;
}) {
  const top = useSharedValue(index * rowHeight);
  const lifted = useSharedValue(false);
  const startTop = useSharedValue(0);
  const startScroll = useSharedValue(0);
  const translation = useSharedValue(0);
  const [minIndex, maxIndex] = range;

  useAnimatedReaction(
    () => positions.value[id],
    (position, previous) => {
      if (position == null || position === previous || lifted.value) return;
      top.set(withTiming(position * rowHeight, { duration: 180 }));
    },
  );

  useAnimatedReaction(
    () => (lifted.value ? startTop.value + translation.value + (scrollY.value - startScroll.value) : null),
    (y) => {
      if (y == null) return;
      const slot = Math.min(maxIndex, Math.max(minIndex, Math.round(y / rowHeight)));
      if (positions.value[id] !== slot) positions.set(moveInMap(positions.value, id, slot));
      const inViewport = y + headerHeight - scrollY.value;
      autoScroll.set(
        inViewport < AUTO_SCROLL_EDGE * 0.5 ? -1 : inViewport + rowHeight > viewportHeight.value - AUTO_SCROLL_EDGE * 0.5 ? 1 : 0,
      );
    },
  );

  const finishDrag = useCallback(
    (moved: boolean, slot: number) => {
      onDragChange(false);
      if (moved) onMove(id, slot);
      else onHold(id);
    },
    [id, onDragChange, onHold, onMove],
  );
  const startDrag = useCallback(() => onDragChange(true), [onDragChange]);
  const hold = useCallback(() => onHold(id), [id, onHold]);

  const drag = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(LIFT_AFTER_MS)
        .onStart(() => {
          lifted.set(true);
          startTop.set(top.value);
          startScroll.set(scrollY.value);
          translation.set(0);
          runOnJS(startDrag)();
        })
        .onUpdate((event) => {
          translation.set(event.translationY);
        })
        .onEnd(() => {
          const moved = Math.abs(translation.value) > MOVE_SLOP;
          const slot = positions.value[id] ?? index;
          lifted.set(false);
          autoScroll.set(0);
          top.set(withTiming(slot * rowHeight, { duration: 160 }));
          runOnJS(finishDrag)(moved, slot);
        })
        .onFinalize((_event, success) => {
          if (!success && lifted.value) {
            lifted.set(false);
            autoScroll.set(0);
            const slot = positions.value[id] ?? index;
            top.set(withTiming(slot * rowHeight, { duration: 160 }));
            runOnJS(finishDrag)(true, slot);
          }
        }),
    [autoScroll, finishDrag, id, index, lifted, positions, rowHeight, scrollY, startDrag, startScroll, startTop, top, translation],
  );

  const longPress = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(LIFT_AFTER_MS)
        .onStart(() => {
          runOnJS(hold)();
        }),
    [hold],
  );

  const style = useAnimatedStyle(() => {
    const y = lifted.value ? startTop.value + translation.value + (scrollY.value - startScroll.value) : top.value;
    return {
      position: 'absolute',
      left: 0,
      right: 0,
      height: rowHeight,
      transform: [{ translateY: y }, { scale: withTiming(lifted.value ? 1.02 : 1, { duration: 120 }) }],
      zIndex: lifted.value ? 10 : 1,
      elevation: lifted.value ? 8 : 0,
    };
  });

  return (
    <GestureDetector gesture={dragEnabled ? drag : longPress}>
      <Animated.View style={style}>{children}</Animated.View>
    </GestureDetector>
  );
});
