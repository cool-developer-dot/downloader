/**
 * B1 — what duplicate / close several / undo do to the tab list, as pure plans. The store
 * (`stores/browserStore/tab-management-actions.ts`) only applies them (mount pool, persistence, cleanup).
 * Tested under Node by `tab-management-plans.test.ts`.
 */

import {
  insertTabAfter,
  planCloseTabs,
  restoreClosedTabs,
  type ClosedTabSlot,
  type OrderableTab,
} from './tab-list-ops.ts';

export type DuplicatePlan<T> =
  | { status: 'CREATED'; tabs: T[]; copy: T }
  | { status: 'LIMIT_REACHED' }
  | { status: 'NOT_FOUND' };

/** The copy goes right after its tab (and inherits pinned); refused at `maxTabs`. */
export function planDuplicate<T extends OrderableTab>(
  tabs: readonly T[],
  sourceId: string,
  maxTabs: number,
  makeCopy: (source: T) => T,
): DuplicatePlan<T> {
  const source = tabs.find((t) => t.id === sourceId);
  if (!source) return { status: 'NOT_FOUND' };
  if (tabs.length >= maxTabs) return { status: 'LIMIT_REACHED' };
  const copy = makeCopy(source);
  return { status: 'CREATED', tabs: insertTabAfter(tabs, source.id, { ...copy, pinned: source.pinned }), copy };
}

export type BackgroundTabPlan<T> =
  | { status: 'CREATED'; tabs: T[]; tab: T; mountNow: boolean }
  | { status: 'LIMIT_REACHED' };

/**
 * B6 #51 Open in background tab: the new tab goes right after the tab in front (after the pinned block when that one
 * is pinned) and the tab in front stays in front. It loads now when a WebView slot is free (`mountedCount` <
 * `maxMounted`), otherwise when it is first shown. Refused at `maxTabs`.
 */
export function planBackgroundTab<T extends OrderableTab>(
  tabs: readonly T[],
  activeTabId: string,
  limits: { maxTabs: number; mountedCount: number; maxMounted: number },
  makeTab: () => T,
): BackgroundTabPlan<T> {
  if (tabs.length >= limits.maxTabs) return { status: 'LIMIT_REACHED' };
  const tab = { ...makeTab(), pinned: false };
  const anchor = tabs.some((t) => t.id === activeTabId) ? activeTabId : null;
  return {
    status: 'CREATED',
    tabs: insertTabAfter(tabs, anchor, tab),
    tab,
    mountNow: limits.mountedCount < limits.maxMounted,
  };
}

export type CloseManyPlan<T> = {
  tabs: T[];
  activeTabId: string;
  closed: ClosedTabSlot<T>[];
  /** The fresh start page added in front (Close all, or nothing left), removed again by an untouched Undo. */
  replacementHomeTabId: string | null;
};

/**
 * Close other tabs / Close all tabs. Pinned tabs stay unless `includePinned`. Close all always ends with one fresh
 * start page in front; Close other tabs leaves `keepTabId` in front.
 */
export function planCloseMany<T extends OrderableTab>(
  tabs: readonly T[],
  activeTabId: string,
  request: { kind: 'all' } | { kind: 'others'; keepTabId: string },
  includePinned: boolean,
  makeHome: () => T,
): CloseManyPlan<T> | null {
  const ids = tabs
    .filter((t) => (request.kind === 'all' || t.id !== request.keepTabId) && (includePinned || !t.pinned))
    .map((t) => t.id);
  if (ids.length === 0) return null;
  const plan = planCloseTabs(tabs, activeTabId, ids);
  let next = plan.remaining;
  let active = plan.activeTabId;
  let replacementHomeTabId: string | null = null;
  if (next.length === 0 || request.kind === 'all') {
    const home = makeHome();
    next = [...next, home];
    active = home.id;
    replacementHomeTabId = home.id;
  } else if (request.kind === 'others' && next.some((t) => t.id === request.keepTabId)) {
    active = request.keepTabId;
  }
  return { tabs: next, activeTabId: active!, closed: plan.closed, replacementHomeTabId };
}

export type UndoPlan<T> =
  | { status: 'RESTORED'; tabs: T[]; activeTabId: string; restored: T[]; dropped: T[]; removedReplacementId: string | null }
  | { status: 'LIMIT_REACHED'; dropped: T[] };

/**
 * Undo / Reopen: put closed tabs back at their old places. An untouched start page the close left behind
 * (`replacementHomeTabId`, still on the start page) gives its place back first. What does not fit under `maxTabs`
 * is reported as dropped. The tab that was in front before the close comes back in front when it was restored.
 */
export function planRestore<T extends OrderableTab>(
  tabs: readonly T[],
  activeTabId: string,
  slots: readonly ClosedTabSlot<T>[],
  options: {
    maxTabs: number;
    preferredActiveId: string | null;
    replacementHomeTabId: string | null;
    isHomeUrl: (url: string) => boolean;
  },
): UndoPlan<T> {
  let base = [...tabs];
  let removedReplacementId: string | null = null;
  const replacement = options.replacementHomeTabId
    ? base.find((t) => t.id === options.replacementHomeTabId)
    : undefined;
  if (replacement && options.isHomeUrl(replacement.url)) {
    base = base.filter((t) => t.id !== replacement.id);
    removedReplacementId = replacement.id;
  }
  const result = restoreClosedTabs(base, slots, options.maxTabs);
  if (result.restored.length === 0) {
    return { status: 'LIMIT_REACHED', dropped: result.dropped };
  }
  const restoredIds = new Set(result.restored.map((t) => t.id));
  let active = activeTabId;
  if (options.preferredActiveId && restoredIds.has(options.preferredActiveId)) {
    active = options.preferredActiveId;
  } else if (!result.tabs.some((t) => t.id === active)) {
    active = result.restored[0]!.id;
  }
  return {
    status: 'RESTORED',
    tabs: result.tabs,
    activeTabId: active,
    restored: result.restored,
    dropped: result.dropped,
    removedReplacementId,
  };
}
