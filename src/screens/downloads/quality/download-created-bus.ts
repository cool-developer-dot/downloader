type DownloadCreatedListener = () => void;
type SheetClosedListener = () => void;

const downloadCreatedListeners = new Set<DownloadCreatedListener>();
const sheetClosedListeners = new Set<SheetClosedListener>();

/**
 * Browser CTA / quality sheet handoff bus.
 * Kept separate from QualitySelectionProvider to avoid import cycles with
 * useBrowserMediaAction.
 *
 * Created = Phase 1 job admitted → consume CTA.
 * Closed without create = quality cancel → restore AVAILABLE.
 */
export function registerQualitySelectionDownloadListener(
  listener: DownloadCreatedListener,
): () => void {
  downloadCreatedListeners.add(listener);
  return () => {
    downloadCreatedListeners.delete(listener);
  };
}

export function notifyQualitySelectionDownloadCreated(): void {
  downloadCreatedListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ignore
    }
  });
}

export function registerQualitySelectionClosedListener(
  listener: SheetClosedListener,
): () => void {
  sheetClosedListeners.add(listener);
  return () => {
    sheetClosedListeners.delete(listener);
  };
}

export function notifyQualitySelectionClosed(): void {
  sheetClosedListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ignore
    }
  });
}
