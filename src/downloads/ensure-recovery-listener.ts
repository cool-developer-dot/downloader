import { downloadEngine } from '@/downloads/engine';
import { downloadAppLifecycle } from '@/downloads/execution';

let attached = false;
let unsub: (() => void) | null = null;

/**
 * Lightweight foreground reconciliation for interrupted downloads.
 * Routes through the canonical AppState coordinator + scheduler.
 * Does not start workers directly. Does not thrash FGS on inactive.
 */
export function ensureDownloadRecoveryListener(): void {
  if (attached) {
    return;
  }
  attached = true;

  downloadAppLifecycle.ensureAttached();

  unsub = downloadAppLifecycle.subscribe((event) => {
    if (!event.becameActive) {
      // Background / inactive: FGS follows active transfer count, not AppState.
      // Do not re-enqueue or recreate workers.
      return;
    }
    void (async () => {
      try {
        const { getDownloadNotificationService } = await import(
          '@/downloads/notifications'
        );
        await getDownloadNotificationService().refreshPermissionState();
      } catch {
        // non-fatal
      }
      await downloadEngine.reconcileForeground();
      downloadEngine.reevaluate();
    })();
  });
}

/** Test helper. */
export function resetDownloadRecoveryListenerForTests(): void {
  unsub?.();
  unsub = null;
  attached = false;
}
