/**
 * P8 #692 Customize Controls: the user's order and hidden set for each group of controls (the page's chips and tiles,
 * the full-screen bars), kept apart from the code that draws them. Pure and generic over the ids, so the rules below
 * are tested once for every group.
 *
 * A group is drawn from its **available** ids: the code's default order, minus the controls switched off by a flag
 * (the Audio chip until Faran's P17). The saved layout is applied on top:
 *
 * - **Order:** the saved ids that are available, in the saved order (anything else in the saved list — an id that no
 *   longer exists, a flagged-off control, a duplicate, a non-string — is skipped). An available id that is not in the
 *   saved list (a control added later, or a flag turned on later) goes to its **default place**: right after the
 *   nearest control that comes before it in the default order and is already placed; at the front if there is none.
 * - **Hidden:** a set of ids; an id not in it is shown, so a new control always shows.
 * - **Nothing saved** (or Reset) → exactly the default order with everything shown.
 */

export type ControlGroupLayout = {
  order: readonly string[];
  hidden: readonly string[];
};

/** Every group's saved layout, by group id. A group with no entry uses its defaults. */
export type ControlsLayout = Readonly<Record<string, ControlGroupLayout>>;

export const DEFAULT_CONTROLS_LAYOUT: ControlsLayout = {};

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.length > 0 && !seen.has(entry)) {
      seen.add(entry);
      out.push(entry);
    }
  }
  return out;
}

/** A stored value read back: unusable groups are dropped, lists keep their strings once each. */
export function normalizeControlsLayout(raw: unknown): ControlsLayout {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_CONTROLS_LAYOUT;
  }
  const out: Record<string, ControlGroupLayout> = {};
  for (const [group, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }
    const entry = value as Record<string, unknown>;
    out[group] = { order: stringList(entry.order), hidden: stringList(entry.hidden) };
  }
  return out;
}

/**
 * The available ids in the user's order (see the rules above). `available` is the default order of what can be drawn
 * now; `saved` may be anything read back from storage.
 */
export function arrangeControls<Id extends string>(
  available: readonly Id[],
  saved: ControlGroupLayout | null | undefined,
): Id[] {
  const availableSet = new Set<string>(available);
  const placed: Id[] = [];
  for (const id of stringList(saved?.order)) {
    if (availableSet.has(id)) {
      placed.push(id as Id);
    }
  }
  if (placed.length === 0) {
    return [...available];
  }
  for (let index = 0; index < available.length; index += 1) {
    const id = available[index]!;
    if (placed.includes(id)) {
      continue;
    }
    let at = 0;
    for (let before = index - 1; before >= 0; before -= 1) {
      const position = placed.indexOf(available[before]!);
      if (position >= 0) {
        at = position + 1;
        break;
      }
    }
    placed.splice(at, 0, id);
  }
  return placed;
}

/** What the customize sheet lists for a group: every available control, in the user's order, shown or not. */
export function controlsInGroup<Id extends string>(
  available: readonly Id[],
  saved: ControlGroupLayout | null | undefined,
): { id: Id; shown: boolean }[] {
  const hidden = new Set(stringList(saved?.hidden));
  return arrangeControls(available, saved).map((id) => ({ id, shown: !hidden.has(id) }));
}

/** What the screen draws for a group: the shown controls, in the user's order. */
export function shownControls<Id extends string>(
  available: readonly Id[],
  saved: ControlGroupLayout | null | undefined,
): Id[] {
  return controlsInGroup(available, saved)
    .filter((entry) => entry.shown)
    .map((entry) => entry.id);
}

/** The saved hidden ids that are available now: what a group saves is only about controls the user could see. */
function availableHidden(available: readonly string[], saved: ControlGroupLayout | null | undefined): string[] {
  return stringList(saved?.hidden).filter((id) => available.includes(id));
}

/**
 * Moves one control a place earlier (-1) or later (+1) among the available ones. Returns the group's new layout, or
 * null when it cannot move (already first / last, or not available).
 */
export function moveControl<Id extends string>(
  available: readonly Id[],
  saved: ControlGroupLayout | null | undefined,
  id: Id,
  direction: -1 | 1,
): ControlGroupLayout | null {
  const order = arrangeControls(available, saved);
  const from = order.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= order.length) {
    return null;
  }
  const next = [...order];
  next[from] = next[to]!;
  next[to] = id;
  return { order: next, hidden: availableHidden(available, saved) };
}

/** Shows or hides one control. Returns the group's new layout (the order is kept as the user sees it). */
export function setControlShown<Id extends string>(
  available: readonly Id[],
  saved: ControlGroupLayout | null | undefined,
  id: Id,
  shown: boolean,
): ControlGroupLayout {
  const hidden = availableHidden(available, saved).filter((entry) => entry !== id);
  if (!shown && available.includes(id)) {
    hidden.push(id);
  }
  return { order: arrangeControls(available, saved), hidden };
}

/** The whole layout with one group replaced. */
export function withGroupLayout(layout: ControlsLayout, group: string, next: ControlGroupLayout): ControlsLayout {
  return { ...layout, [group]: next };
}
