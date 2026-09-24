/**
 * A download started from the browser that fails because its link must be fetched fresh (expired, refused, gone)
 * gives its video back to the page's offer. "Open the video page again" then shows "Video available" with the link
 * the page has now, instead of a page that still remembers the video as already downloaded.
 */
import { notifyBrowserDetectionSync } from '@/media-detection/services/browser-sync.service';
import { useDownloadsStore } from '@/store/downloads';

import { browserMediaActionService } from './browser-media-action.service';
import { newlyFailedForFreshSource, type DownloadRowLike } from './consumed-release-rows';

let detach: (() => void) | null = null;

/** Idempotent: one store subscription for the app's life. */
export function ensureConsumedReleaseOnFailure(): void {
  if (detach) {
    return;
  }
  detach = useDownloadsStore.subscribe((state, previous) => {
    if (state.engineRowsById === previous.engineRowsById) {
      return;
    }
    const ids = newlyFailedForFreshSource(
      state.engineRowsById as Record<string, DownloadRowLike>,
      previous.engineRowsById as Record<string, DownloadRowLike>,
    );
    let released = false;
    for (const id of ids) {
      released = browserMediaActionService.releaseConsumedDownload(id) || released;
    }
    if (released) {
      // The page is re-evaluated, so its current (fresh) source is verified and offered again.
      notifyBrowserDetectionSync();
    }
  });
}
