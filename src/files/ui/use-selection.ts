import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';

import { useAndroidBackHandler } from '@/navigation/hooks';

import {
  dragModeFor,
  EMPTY_SELECTION,
  invertSelection,
  rangeSelection,
  selectAll as selectAllOf,
  toggleSelection,
  withoutRemovedIds,
  type DragMode,
} from './selection';

type Drag = { base: ReadonlySet<string>; anchorId: string; mode: DragMode };

/**
 * Files F4: a Files list's selection (`selection.ts`). A long press starts it with that row selected (and a drag from
 * there selects a range); while it is on, a tap toggles a row. Ids that leave the list drop out of it at once. Android
 * back leaves selection mode first; leaving the screen clears it. It lives in the screen's state, so scrolling (and a
 * rotation, which keeps the screen) keeps it.
 */
export function useSelection(orderedIds: readonly string[]) {
  const [raw, setRaw] = useState<ReadonlySet<string>>(EMPTY_SELECTION);
  const dragRef = useRef<Drag | null>(null);
  const selected = useMemo(() => withoutRemovedIds(raw, orderedIds), [orderedIds, raw]);
  const active = selected.size > 0;

  const clear = useCallback(() => {
    dragRef.current = null;
    setRaw(EMPTY_SELECTION);
  }, []);

  const toggle = useCallback((id: string) => setRaw((current) => toggleSelection(current, id)), []);

  /** A long press without a drag (TalkBack's double-tap-and-hold too): select the row, never unselect it. */
  const startWith = useCallback((id: string) => {
    setRaw((current) => (current.has(id) ? current : toggleSelection(current, id)));
  }, []);

  const dragStart = useCallback(
    (index: number) => {
      const id = orderedIds[index];
      if (!id) return;
      const base = withoutRemovedIds(raw, orderedIds);
      const mode = dragModeFor(base, id);
      dragRef.current = { base, anchorId: id, mode };
      setRaw(rangeSelection(base, orderedIds, id, id, mode));
    },
    [orderedIds, raw],
  );

  const dragOver = useCallback(
    (index: number) => {
      const drag = dragRef.current;
      const id = orderedIds[index];
      if (!drag || !id) return;
      setRaw(rangeSelection(drag.base, orderedIds, drag.anchorId, id, drag.mode));
    },
    [orderedIds],
  );

  const dragEnd = useCallback(() => {
    dragRef.current = null;
  }, []);

  const selectAll = useCallback(() => setRaw(selectAllOf(orderedIds)), [orderedIds]);
  const invert = useCallback(() => setRaw((current) => invertSelection(withoutRemovedIds(current, orderedIds), orderedIds)), [orderedIds]);

  // Android back leaves selection mode (the screen stays).
  useAndroidBackHandler({
    enabled: active,
    onBackPress: () => {
      clear();
      return true;
    },
  });

  // Leaving the screen clears the selection.
  useFocusEffect(useCallback(() => () => clear(), [clear]));

  return { selected, active, count: selected.size, toggle, startWith, dragStart, dragOver, dragEnd, selectAll, invert, clear };
}

export type SelectionController = ReturnType<typeof useSelection>;
