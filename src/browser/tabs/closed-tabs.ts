/**
 * B1 #3 — the stack of recently closed tabs (newest first, at most 10). Pure: `closed-tabs.service.ts` keeps it in
 * MMKV. Each entry remembers where the tab was and whether it was pinned; a close of several tabs at once (Close all,
 * Close other tabs) shares one `batchId`, so Undo brings the whole group back. Back/forward history is not kept — a
 * reopened tab loads its last URL fresh.
 */

export const MAX_CLOSED_TABS = 10;

export type ClosedTabEntry = {
  id: string;
  url: string;
  title: string;
  /** Position in the tab list when it was closed. */
  index: number;
  pinned: boolean;
  desktopMode: boolean;
  desktopModeSource: 'default' | 'user' | 'platform';
  createdAt: number;
  closedAt: number;
  batchId: string;
};

export type ClosedTabsEnvelope = {
  version: 1;
  entries: ClosedTabEntry[];
};

/** Adds one close (one or more tabs) on top of the stack, keeping the newest `max` entries. */
export function pushClosedTabs(
  stack: readonly ClosedTabEntry[],
  entries: readonly ClosedTabEntry[],
  max: number = MAX_CLOSED_TABS,
): ClosedTabEntry[] {
  if (entries.length === 0) return [...stack];
  const ids = new Set(entries.map((e) => e.id));
  // Newest first; within one batch keep list order so a later restore walks it naturally.
  const fresh = [...entries].sort((a, b) => a.index - b.index);
  return [...fresh, ...stack.filter((e) => !ids.has(e.id))].slice(0, Math.max(0, max));
}

/** Removes and returns every entry of one close. */
export function takeClosedBatch(
  stack: readonly ClosedTabEntry[],
  batchId: string,
): { taken: ClosedTabEntry[]; stack: ClosedTabEntry[] } {
  const taken = stack.filter((e) => e.batchId === batchId);
  return { taken, stack: stack.filter((e) => e.batchId !== batchId) };
}

/** Removes and returns the most recently closed tab ("Reopen closed tab", Ctrl+Shift+T). */
export function takeLatestClosed(stack: readonly ClosedTabEntry[]): {
  taken: ClosedTabEntry | null;
  stack: ClosedTabEntry[];
} {
  if (stack.length === 0) return { taken: null, stack: [] };
  let latest = 0;
  for (let i = 1; i < stack.length; i += 1) {
    if (stack[i]!.closedAt > stack[latest]!.closedAt) latest = i;
  }
  const taken = stack[latest]!;
  return { taken, stack: stack.filter((_, i) => i !== latest) };
}

function isHttpOrHome(url: string, homeUrl: string): boolean {
  if (url === homeUrl) return true;
  return /^https?:\/\//i.test(url);
}

/** Reads a stored envelope defensively: unknown fields are ignored, broken entries dropped. */
export function sanitizeClosedTabs(raw: unknown, homeUrl: string, max: number = MAX_CLOSED_TABS): ClosedTabEntry[] {
  if (!raw || typeof raw !== 'object') return [];
  const list = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: ClosedTabEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Partial<ClosedTabEntry>;
    const id = typeof e.id === 'string' ? e.id.trim() : '';
    const url = typeof e.url === 'string' ? e.url.trim() : '';
    if (!id || seen.has(id) || !isHttpOrHome(url, homeUrl)) continue;
    const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
    const closedAt = num(e.closedAt, 0);
    seen.add(id);
    out.push({
      id,
      url,
      title: typeof e.title === 'string' ? e.title.slice(0, 255) : '',
      index: Math.max(0, Math.round(num(e.index, 0))),
      pinned: e.pinned === true,
      desktopMode: e.desktopMode === true,
      desktopModeSource:
        e.desktopModeSource === 'user' || e.desktopModeSource === 'platform' ? e.desktopModeSource : 'default',
      createdAt: num(e.createdAt, closedAt),
      closedAt,
      batchId: typeof e.batchId === 'string' && e.batchId ? e.batchId : id,
    });
    if (out.length >= max) break;
  }
  return out;
}
