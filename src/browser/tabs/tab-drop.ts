/**
 * B2 #6 — dragging a tab in B1's list: where it goes, and whether it is being dropped onto a neighbour (to group the
 * two). Pure and a worklet, so the drag can use it on the UI thread and the tests can use it in Node.
 *
 * Positions are in rows: `offset` is how far the lifted card is from its current slot (0.5 = half a row down). With
 * grouping, a card only takes the next slot once it covers SWAP_AT of it; between MERGE_FROM and SWAP_AT it sits over
 * the neighbour, which is the drop target. Without grouping it swaps at half a row, as B1 always did.
 */

export const SWAP_AT = 0.7;
export const MERGE_FROM = 0.3;

export type DragPlacement = {
  /** The slot the lifted card takes now. */
  slot: number;
  /** -1 / 1: dropping now groups the card with the neighbour above / below `slot`; 0: no drop target. */
  dropOnto: -1 | 0 | 1;
};

/**
 * `rowPosition` is the lifted card's top in rows (y / row height), `current` its slot so far, `min`..`max` the slots it
 * may take (pinned tabs stay among pinned ones). Moves as many slots as the card covers, so a fast drag that stops
 * still lands where the finger is.
 */
export function placeDraggedTab(rowPosition: number, current: number, min: number, max: number, canGroup: boolean): DragPlacement {
  'worklet';
  const swapAt = canGroup ? SWAP_AT : 0.5;
  let slot = Math.min(max, Math.max(min, current));
  let offset = rowPosition - slot;
  // One direction per update (stepping down by exactly swapAt must not step straight back up).
  if (offset >= swapAt) {
    while (offset >= swapAt && slot < max) {
      slot += 1;
      offset -= 1;
    }
  } else {
    while (offset <= -swapAt && slot > min) {
      slot -= 1;
      offset += 1;
    }
  }
  if (!canGroup) return { slot, dropOnto: 0 };
  if (offset > MERGE_FROM && offset < SWAP_AT && slot + 1 <= max) return { slot, dropOnto: 1 };
  if (offset < -MERGE_FROM && offset > -SWAP_AT && slot - 1 >= min) return { slot, dropOnto: -1 };
  return { slot, dropOnto: 0 };
}
