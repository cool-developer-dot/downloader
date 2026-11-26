/**
 * F14, pure: duplicate grouping (#819), the one-tap clean plan (#853, with #852's leftover files) and the low space
 * decision (#855). The runtime files around it read the library and the engine.
 */

/** What the duplicate finder reads of a library item. */
export type DuplicateCandidate = { id: string; fileSize: string; downloadedAt: string | null };

function bytes(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Ids whose size matches another item's (only those need hashing). Empty files never count. */
export function sizeCandidates(items: readonly DuplicateCandidate[]): string[][] {
  const bySize = new Map<number, string[]>();
  for (const item of items) {
    const size = bytes(item.fileSize);
    if (size === 0) {
      continue;
    }
    const list = bySize.get(size) ?? [];
    list.push(item.id);
    bySize.set(size, list);
  }
  return [...bySize.values()].filter((ids) => ids.length > 1);
}

/** Groups of two or more items with the same content hash; each group newest first, groups largest first. */
export function groupsFromHashes<T extends DuplicateCandidate>(
  items: readonly T[],
  hashById: ReadonlyMap<string, string>,
): { hash: string; items: T[] }[] {
  const byHash = new Map<string, T[]>();
  for (const item of items) {
    const hash = hashById.get(item.id);
    if (!hash) {
      continue;
    }
    const list = byHash.get(hash) ?? [];
    list.push(item);
    byHash.set(hash, list);
  }
  const time = (item: T) => (item.downloadedAt ? Date.parse(item.downloadedAt) || 0 : 0);
  return [...byHash.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([hash, list]) => ({ hash, items: [...list].sort((a, b) => time(b) - time(a) || (a.id < b.id ? -1 : 1)) }))
    .sort((a, b) => bytes(b.items[0]!.fileSize) - bytes(a.items[0]!.fileSize) || (a.hash < b.hash ? -1 : 1));
}

export type CleanPlan = {
  cacheBytes: number;
  leftoverBytes: number;
  tempBytes: number;
  binExpiredBytes: number;
  total: number;
};

export function buildCleanPlan(parts: Omit<CleanPlan, 'total'>): CleanPlan {
  const safe = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  const plan = {
    cacheBytes: safe(parts.cacheBytes),
    leftoverBytes: safe(parts.leftoverBytes),
    tempBytes: safe(parts.tempBytes),
    binExpiredBytes: safe(parts.binExpiredBytes),
  };
  return { ...plan, total: plan.cacheBytes + plan.leftoverBytes + plan.tempBytes + plan.binExpiredBytes };
}

const MB = 1024 * 1024;
export const LOW_SPACE_THRESHOLDS = [500 * MB, 1024 * MB, 2048 * MB] as const;

export type LowSpaceSettings = { enabled: boolean; thresholdBytes: number };
export const DEFAULT_LOW_SPACE: LowSpaceSettings = { enabled: true, thresholdBytes: 1024 * MB };

export function normalizeLowSpaceSettings(raw: unknown): LowSpaceSettings {
  const value = (raw ?? {}) as Partial<Record<keyof LowSpaceSettings, unknown>>;
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_LOW_SPACE.enabled,
    thresholdBytes: (LOW_SPACE_THRESHOLDS as readonly number[]).includes(value.thresholdBytes as number)
      ? (value.thresholdBytes as number)
      : DEFAULT_LOW_SPACE.thresholdBytes,
  };
}

/** The local calendar day, "2026-11-26": the alert goes out at most once per day. */
export function dayKey(nowMs: number): string {
  const d = new Date(nowMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Whether space is low now, and whether to send today's notification. Unknown free space (null) is never "low" —
 * no alert on a guess.
 */
export function lowSpaceDecision(input: {
  settings: LowSpaceSettings;
  freeBytes: number | null;
  lastAlertDay: string | null;
  nowMs: number;
}): { low: boolean; notify: boolean } {
  const { settings, freeBytes } = input;
  const low = settings.enabled && freeBytes != null && freeBytes < settings.thresholdBytes;
  return { low, notify: low && input.lastAlertDay !== dayKey(input.nowMs) };
}
