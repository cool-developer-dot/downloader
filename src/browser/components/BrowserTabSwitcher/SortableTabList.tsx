import { memo, useCallback, useEffect, useMemo, useState } from 'react';
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

import type { BrowserTab } from '@/browser/tabs/types';
import { placeDraggedTab } from '@/browser/tabs/tab-drop';

import { TabCard, TAB_CARD_HEIGHT } from './TabCard';

/** One row: the card plus the gap below it. Rows have a fixed height so positions are index × ROW_HEIGHT. */
export const TAB_ROW_HEIGHT = TAB_CARD_HEIGHT + 8;
const LIFT_AFTER_MS = 380;
const AUTO_SCROLL_EDGE = 72;
const AUTO_SCROLL_STEP = 9;
const MOVE_SLOP = 10;

type Positions = Record<string, number>;

function indexMap(tabs: readonly BrowserTab[]): Positions {
  const map: Positions = {};
  tabs.forEach((tab, index) => {
    map[tab.id] = index;
  });
  return map;
}

/** Worklet: `id` moved to `target`, the others shifted, as a new map. */
function moveInMap(map: Positions, id: string, target: number): Positions {
  'worklet';
  const ids = Object.keys(map).sort((a, b) => map[a]! - map[b]!);
  const from = ids.indexOf(id);
  if (from < 0) return map;
  ids.splice(from, 1);
  ids.splice(target, 0, id);
  const next: Positions = {};
  for (let i = 0; i < ids.length; i += 1) {
    next[ids[i]!] = i;
  }
  return next;
}

export type SortableTabListProps = {
  tabs: readonly BrowserTab[];
  activeTabId: string;
  /** Drag to reorder: only in Manual order without a search. Long-press opens the options either way. */
  dragEnabled: boolean;
  pinnedCount: number;
  canMove: (tabId: string, delta: -1 | 1) => boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onOptions: (tabId: string) => void;
  onMove: (tabId: string, toIndex: number) => void;
  onMoveBy: (tabId: string, delta: -1 | 1) => void;
  /** B2: a tab dropped onto another (held over it, then let go) — group the two. Without it, drags only reorder. */
  onDropOnto?: (tabId: string, targetId: string) => void;
};

export const SortableTabList = memo(function SortableTabList({
  tabs,
  activeTabId,
  dragEnabled,
  pinnedCount,
  canMove,
  onSelect,
  onClose,
  onOptions,
  onMove,
  onMoveBy,
  onDropOnto,
}: SortableTabListProps) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  // B2: the tab the lifted card would be dropped onto now (highlighted), or null.
  const dropTarget = useSharedValue<string | null>(null);
  const positions = useSharedValue<Positions>(indexMap(tabs));
  const scrollY = useSharedValue(0);
  const viewportHeight = useSharedValue(0);
  const contentHeight = useSharedValue(tabs.length * TAB_ROW_HEIGHT);
  const autoScroll = useSharedValue(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    positions.value = indexMap(tabs);
    contentHeight.value = tabs.length * TAB_ROW_HEIGHT;
  }, [contentHeight, positions, tabs]);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  // Auto-scroll while a lifted card is held near the top or bottom edge.
  useFrameCallback(() => {
    if (autoScroll.value === 0) return;
    const max = Math.max(0, contentHeight.value - viewportHeight.value);
    const next = Math.min(max, Math.max(0, scrollY.value + autoScroll.value * AUTO_SCROLL_STEP));
    if (next !== scrollY.value) {
      scrollTo(scrollRef, 0, next, false);
      scrollY.value = next;
    }
  });

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewportHeight.value = event.nativeEvent.layout.height;
    },
    [viewportHeight],
  );

  return (
    <Animated.ScrollView
      ref={scrollRef}
      style={{ flexGrow: 0 }}
      onScroll={onScroll}
      scrollEventThrottle={16}
      scrollEnabled={!dragging}
      onLayout={handleLayout}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ height: tabs.length * TAB_ROW_HEIGHT, marginHorizontal: 16 }}>
      {tabs.map((tab, index) => (
        <SortableTabRow
          key={tab.id}
          tab={tab}
          index={index}
          count={tabs.length}
          active={tab.id === activeTabId}
          dragEnabled={dragEnabled}
          range={tab.pinned ? [0, Math.max(0, pinnedCount - 1)] : [pinnedCount, tabs.length - 1]}
          positions={positions}
          scrollY={scrollY}
          viewportHeight={viewportHeight}
          autoScroll={autoScroll}
          canMoveUp={dragEnabled && canMove(tab.id, -1)}
          canMoveDown={dragEnabled && canMove(tab.id, 1)}
          onDragChange={setDragging}
          onSelect={onSelect}
          onClose={onClose}
          onOptions={onOptions}
          onMove={onMove}
          onMoveBy={onMoveBy}
          dropTarget={dropTarget}
          onDropOnto={onDropOnto}
        />
      ))}
    </Animated.ScrollView>
  );
});

type SortableTabRowProps = {
  tab: BrowserTab;
  index: number;
  count: number;
  active: boolean;
  dragEnabled: boolean;
  range: [number, number];
  positions: SharedValue<Positions>;
  scrollY: SharedValue<number>;
  viewportHeight: SharedValue<number>;
  autoScroll: SharedValue<number>;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onDragChange: (dragging: boolean) => void;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onOptions: (tabId: string) => void;
  onMove: (tabId: string, toIndex: number) => void;
  onMoveBy: (tabId: string, delta: -1 | 1) => void;
  dropTarget: SharedValue<string | null>;
  onDropOnto?: (tabId: string, targetId: string) => void;
};

const SortableTabRow = memo(function SortableTabRow({
  tab,
  index,
  count,
  active,
  dragEnabled,
  range,
  positions,
  scrollY,
  viewportHeight,
  autoScroll,
  canMoveUp,
  canMoveDown,
  onDragChange,
  onSelect,
  onClose,
  onOptions,
  onMove,
  onMoveBy,
  dropTarget,
  onDropOnto,
}: SortableTabRowProps) {
  const canGroup = onDropOnto != null;
  const top = useSharedValue(index * TAB_ROW_HEIGHT);
  const lifted = useSharedValue(false);
  const startTop = useSharedValue(0);
  const startScroll = useSharedValue(0);
  const translation = useSharedValue(0);
  const [minIndex, maxIndex] = range;
  const id = tab.id;

  // Not dragged: follow the position map (another card moved past this one, or the list changed).
  useAnimatedReaction(
    () => positions.value[id],
    (position, previous) => {
      if (position == null || position === previous || lifted.value) return;
      top.value = withTiming(position * TAB_ROW_HEIGHT, { duration: 180 });
    },
  );

  // Dragged: where the card is in the list's own coordinates (finger + auto-scroll), and the slot under it.
  useAnimatedReaction(
    () => (lifted.value ? startTop.value + translation.value + (scrollY.value - startScroll.value) : null),
    (y) => {
      if (y == null) return;
      const current = positions.value[id] ?? index;
      const { slot, dropOnto } = placeDraggedTab(y / TAB_ROW_HEIGHT, current, minIndex, maxIndex, canGroup);
      if (positions.value[id] !== slot) {
        positions.value = moveInMap(positions.value, id, slot);
      }
      // B2: the tab under the lifted card (held over it), the one a release groups it with.
      let target: string | null = null;
      if (dropOnto !== 0) {
        const map = positions.value;
        for (const other of Object.keys(map)) {
          if (other !== id && map[other] === slot + dropOnto) {
            target = other;
            break;
          }
        }
      }
      if (dropTarget.value !== target) dropTarget.value = target;
      const inViewport = y - scrollY.value;
      autoScroll.value =
        inViewport < AUTO_SCROLL_EDGE * 0.5
          ? -1
          : inViewport + TAB_CARD_HEIGHT > viewportHeight.value - AUTO_SCROLL_EDGE * 0.5
            ? 1
            : 0;
    },
  );

  const finishDrag = useCallback(
    (moved: boolean, slot: number, target: string | null) => {
      onDragChange(false);
      if (moved) {
        onMove(id, slot);
        if (target) onDropOnto?.(id, target);
      } else {
        onOptions(id);
      }
    },
    [id, onDragChange, onDropOnto, onMove, onOptions],
  );

  const startDrag = useCallback(() => onDragChange(true), [onDragChange]);
  const openOptions = useCallback(() => onOptions(id), [id, onOptions]);

  const drag = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(LIFT_AFTER_MS)
        .onStart(() => {
          lifted.value = true;
          startTop.value = top.value;
          startScroll.value = scrollY.value;
          translation.value = 0;
          runOnJS(startDrag)();
        })
        .onUpdate((event) => {
          translation.value = event.translationY;
        })
        .onEnd(() => {
          const moved = Math.abs(translation.value) > MOVE_SLOP;
          const slot = positions.value[id] ?? index;
          const target = dropTarget.value;
          dropTarget.value = null;
          lifted.value = false;
          autoScroll.value = 0;
          top.value = withTiming(slot * TAB_ROW_HEIGHT, { duration: 160 });
          runOnJS(finishDrag)(moved, slot, target);
        })
        .onFinalize((_event, success) => {
          if (!success && lifted.value) {
            lifted.value = false;
            autoScroll.value = 0;
            // A cancelled drag never groups.
            dropTarget.value = null;
            const slot = positions.value[id] ?? index;
            top.value = withTiming(slot * TAB_ROW_HEIGHT, { duration: 160 });
            runOnJS(finishDrag)(true, slot, null);
          }
        }),
    [autoScroll, dropTarget, finishDrag, id, index, lifted, positions, scrollY, startDrag, startScroll, startTop, top, translation],
  );

  const hold = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(LIFT_AFTER_MS)
        .onStart(() => {
          runOnJS(openOptions)();
        }),
    [openOptions],
  );

  const style = useAnimatedStyle(() => {
    const y = lifted.value
      ? startTop.value + translation.value + (scrollY.value - startScroll.value)
      : top.value;
    // B2: the drop target shrinks a little and dims, so the lifted card visibly lands "into" it.
    const isDropTarget = dropTarget.value === id;
    return {
      position: 'absolute',
      left: 0,
      right: 0,
      height: TAB_CARD_HEIGHT,
      opacity: withTiming(isDropTarget ? 0.6 : 1, { duration: 120 }),
      transform: [
        { translateY: y },
        { scale: withTiming(lifted.value ? 1.03 : isDropTarget ? 0.94 : 1, { duration: 120 }) },
      ],
      zIndex: lifted.value ? 10 : 1,
      elevation: lifted.value ? 8 : 0,
    };
  });

  return (
    <GestureDetector gesture={dragEnabled ? drag : hold}>
      <Animated.View style={style}>
        <TabCard
          tab={tab}
          active={active}
          position={index + 1}
          count={count}
          dragEnabled={dragEnabled}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onSelect={onSelect}
          onClose={onClose}
          onOptions={onOptions}
          onMoveBy={onMoveBy}
        />
      </Animated.View>
    </GestureDetector>
  );
});
