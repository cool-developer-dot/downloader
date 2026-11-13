/**
 * B11 (pure): the active tab as saved. An incognito tab in front is never saved, so the most recently used saved tab is
 * the one in front after a restart; a saved active tab is kept as it is.
 */
export function savedActiveTabId(
  activeTabId: string,
  kept: readonly { id: string; lastActiveAt: number }[],
): string {
  if (kept.some((tab) => tab.id === activeTabId)) return activeTabId;
  const latest = kept.reduce<{ id: string; lastActiveAt: number } | null>(
    (best, tab) => (!best || tab.lastActiveAt > best.lastActiveAt ? tab : best),
    null,
  );
  return latest?.id ?? activeTabId;
}
