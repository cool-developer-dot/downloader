/**
 * Dependency-neutral desktop-mode snapshot for media request-context builders.
 *
 * Intentionally does NOT import browserStore / social-source / request-context.
 * Browser store binds the reader after creation (composition root).
 */

export type DesktopModeSnapshot = {
  desktopMode: boolean;
  tabs: ReadonlyArray<{ id: string; desktopMode: boolean }>;
};

export type DesktopModeSnapshotReader = () => DesktopModeSnapshot;

let reader: DesktopModeSnapshotReader | null = null;

/** Called once from browser store composition after the store exists. */
export function bindDesktopModeSnapshotReader(
  next: DesktopModeSnapshotReader,
): void {
  reader = next;
}

/**
 * Read desktop mode for UA selection.
 * Falls back to mobile (false) when unbound — safe for early/public paths.
 */
export function readDesktopModeForRequestContext(
  tabId?: string | null,
): boolean {
  if (!reader) {
    return false;
  }
  const snap = reader();
  if (tabId) {
    const tab = snap.tabs.find((t) => t.id === tabId);
    if (tab) {
      return Boolean(tab.desktopMode);
    }
  }
  return Boolean(snap.desktopMode);
}

/** Test helper — clear binding between suites. */
export function resetDesktopModeSnapshotReaderForTests(): void {
  reader = null;
}
