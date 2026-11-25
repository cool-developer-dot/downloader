import { useCallback, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';
import { FlatList, View, type FlatListProps, type LayoutChangeEvent, type ListRenderItem } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

/** Hold this long on a row to start selecting (the same hold as the app's other long presses). */
const LONG_PRESS_MS = 350;
/** Within this distance of the list's top or bottom edge, the list scrolls by itself. */
const AUTO_SCROLL_EDGE = 64;
const AUTO_SCROLL_STEP = 10;

export type DragSelectListProps<T> = Omit<FlatListProps<T>, 'renderItem' | 'ListHeaderComponent' | 'onScroll' | 'ref'> & {
  renderItem: ListRenderItem<T>;
  ListHeaderComponent?: ReactElement | null;
  /** Items per row (1 for a list, 2–4 for the grid). */
  columns: number;
  /** Space between grid rows (0 in a list). */
  rowGap?: number;
  /** Side padding of the content (the hit test skips it). */
  paddingX: number;
  /** Off where nothing can be selected. */
  dragEnabled: boolean;
  /** A hold on item `index`: selection starts there. */
  onDragStart: (index: number) => void;
  /** The finger (or the auto-scroll) is now over item `index`. */
  onDragOver: (index: number) => void;
  onDragEnd: () => void;
  /** The underlying FlatList (scrollToIndex, …). */
  listRef?: { current: FlatList<T> | null };
};

/**
 * Files F4 · #791 Drag select: a FlatList whose rows start a selection on a long press and keep selecting while the
 * finger stays down and moves up or down — the rows between the first one and the finger. Near the list's top or
 * bottom edge it scrolls by itself (reanimated, on the UI thread). Built on react-native-gesture-handler and
 * react-native-reanimated, both already in the app (the same pattern as the browser's sortable lists). The hit test
 * follows rows, not screen sides, so it works the same right to left.
 */
export function DragSelectList<T>({
  renderItem,
  ListHeaderComponent,
  columns,
  rowGap = 0,
  paddingX,
  dragEnabled,
  onDragStart,
  onDragOver,
  onDragEnd,
  listRef,
  data,
  scrollEnabled,
  onContentSizeChange,
  ...rest
}: DragSelectListProps<T>) {
  const animatedRef = useAnimatedRef<FlatList<unknown>>();
  const containerRef = useRef<View>(null);
  const scrollY = useSharedValue(0);
  const viewportTop = useSharedValue(0);
  const viewportHeight = useSharedValue(0);
  const contentHeight = useSharedValue(0);
  const lastX = useSharedValue(0);
  const lastY = useSharedValue(0);
  const autoScroll = useSharedValue(0);
  const [dragging, setDragging] = useState(false);
  const headerHeightRef = useRef(0);
  const rowHeightsRef = useRef<Map<number, number>>(new Map());
  const viewportRef = useRef({ left: 0, width: 0 });
  const lastIndexRef = useRef(-1);
  const count = data ? (data as ArrayLike<T>).length : 0;

  const setRefs = useCallback(
    (node: Animated.FlatList<T> | null) => {
      animatedRef(node as unknown as FlatList<unknown> | null);
      if (listRef) {
        listRef.current = node as unknown as FlatList<T> | null;
      }
    },
    [animatedRef, listRef],
  );

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });

  /** The item under a point on the screen, or -1. */
  const indexAt = useCallback(
    (x: number, y: number): number => {
      if (count === 0) return -1;
      let contentY = y - viewportTop.value + scrollY.value - headerHeightRef.current;
      const heights = rowHeightsRef.current;
      const known = [...heights.values()];
      const average = known.length > 0 ? known.reduce((sum, value) => sum + value, 0) / known.length : 58;
      const rows = Math.ceil(count / columns);
      let row = 0;
      while (row < rows - 1) {
        const height = (heights.get(row) ?? average) + rowGap;
        if (contentY < height) break;
        contentY -= height;
        row += 1;
      }
      const { left, width } = viewportRef.current;
      const cellWidth = columns > 1 ? (width - paddingX * 2) / columns : width;
      const column = columns > 1 ? Math.min(columns - 1, Math.max(0, Math.floor((x - left - paddingX) / cellWidth))) : 0;
      return Math.min(count - 1, Math.max(0, row * columns + column));
    },
    [columns, count, paddingX, rowGap, scrollY, viewportTop],
  );

  const start = useCallback(
    (index: number) => {
      setDragging(true);
      lastIndexRef.current = index;
      // Where the list is on the screen, for the hit test and the edges.
      containerRef.current?.measureInWindow((left, top, width, height) => {
        viewportRef.current = { left, width };
        viewportTop.set(top);
        viewportHeight.set(height);
      });
      onDragStart(index);
    },
    [onDragStart, viewportHeight, viewportTop],
  );

  const move = useCallback(
    (x: number, y: number) => {
      const index = indexAt(x, y);
      if (index >= 0 && index !== lastIndexRef.current) {
        lastIndexRef.current = index;
        onDragOver(index);
      }
    },
    [indexAt, onDragOver],
  );

  const end = useCallback(() => {
    setDragging(false);
    lastIndexRef.current = -1;
    onDragEnd();
  }, [onDragEnd]);

  const moveFromScroll = useCallback(() => move(lastX.value, lastY.value), [lastX, lastY, move]);

  useFrameCallback(() => {
    if (autoScroll.value === 0) return;
    const max = Math.max(0, contentHeight.value - viewportHeight.value);
    const next = Math.min(max, Math.max(0, scrollY.value + autoScroll.value * AUTO_SCROLL_STEP));
    if (next !== scrollY.value) {
      scrollTo(animatedRef, 0, next, false);
      scrollY.set(next);
      runOnJS(moveFromScroll)();
    }
  });

  const renderCell = useCallback<ListRenderItem<T>>(
    (info) => (
      <DragCell
        index={info.index}
        row={Math.floor(info.index / columns)}
        enabled={dragEnabled}
        heights={rowHeightsRef}
        lastX={lastX}
        lastY={lastY}
        autoScroll={autoScroll}
        viewportTop={viewportTop}
        viewportHeight={viewportHeight}
        onStart={start}
        onMove={move}
        onEnd={end}>
        {renderItem(info)}
      </DragCell>
    ),
    [autoScroll, columns, dragEnabled, end, lastX, lastY, move, renderItem, start, viewportHeight, viewportTop],
  );

  const header = useMemo(
    () =>
      ListHeaderComponent ? (
        <View
          onLayout={(event: LayoutChangeEvent) => {
            headerHeightRef.current = event.nativeEvent.layout.height;
          }}>
          {ListHeaderComponent}
        </View>
      ) : null,
    [ListHeaderComponent],
  );

  return (
    <View ref={containerRef} style={{ flex: 1 }} collapsable={false}>
      <Animated.FlatList
        {...(rest as object)}
        ref={setRefs}
        data={data}
        renderItem={renderCell}
        ListHeaderComponent={header}
        onScroll={onScroll}
        scrollEventThrottle={16}
        scrollEnabled={(scrollEnabled ?? true) && !dragging}
        onContentSizeChange={(width: number, height: number) => {
          contentHeight.set(height);
          onContentSizeChange?.(width, height);
        }}
        onLayout={(event: LayoutChangeEvent) => viewportHeight.set(event.nativeEvent.layout.height)}
      />
    </View>
  );
}

function DragCell({
  index,
  row,
  enabled,
  heights,
  lastX,
  lastY,
  autoScroll,
  viewportTop,
  viewportHeight,
  onStart,
  onMove,
  onEnd,
  children,
}: {
  index: number;
  row: number;
  enabled: boolean;
  heights: RefObject<Map<number, number>>;
  lastX: SharedValue<number>;
  lastY: SharedValue<number>;
  autoScroll: SharedValue<number>;
  viewportTop: SharedValue<number>;
  viewportHeight: SharedValue<number>;
  onStart: (index: number) => void;
  onMove: (x: number, y: number) => void;
  onEnd: () => void;
  children: ReactElement | null;
}) {
  const active = useSharedValue(false);
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .activateAfterLongPress(LONG_PRESS_MS)
        .onStart((event) => {
          active.set(true);
          lastX.set(event.absoluteX);
          lastY.set(event.absoluteY);
          runOnJS(onStart)(index);
        })
        .onUpdate((event) => {
          lastX.set(event.absoluteX);
          lastY.set(event.absoluteY);
          const top = viewportTop.value;
          const bottom = top + viewportHeight.value;
          autoScroll.set(event.absoluteY < top + AUTO_SCROLL_EDGE ? -1 : event.absoluteY > bottom - AUTO_SCROLL_EDGE ? 1 : 0);
          runOnJS(onMove)(event.absoluteX, event.absoluteY);
        })
        .onFinalize(() => {
          autoScroll.set(0);
          // Ended or cancelled: a drag that started always ends (a plain tap never started one).
          if (active.value) {
            active.set(false);
            runOnJS(onEnd)();
          }
        }),
    [active, autoScroll, enabled, index, lastX, lastY, onEnd, onMove, onStart, viewportHeight, viewportTop],
  );
  return (
    <GestureDetector gesture={gesture}>
      <View
        collapsable={false}
        onLayout={(event: LayoutChangeEvent) => {
          heights.current?.set(row, event.nativeEvent.layout.height);
        }}>
        {children}
      </View>
    </GestureDetector>
  );
}
