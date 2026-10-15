/**
 * What feeds the Debug Logs buffer while it is on: the detection pipeline's own outcome ledger (hosts and hashes,
 * never URLs) and the v2 engine's state events (state and error code; no URLs). Subscriptions exist only while
 * Debug logs is on; turning it off unsubscribes and empties the buffer.
 */

import { getV2Engine } from '@/downloads/v2/engine-port';
import { subscribePipelineOutcomes } from '@/media-detection/pipeline/pipeline-outcome';

import { debugLog } from './debug-log';

/**
 * The running subscriptions live on `globalThis`: a Fast Refresh re-runs this module, and its subscriptions must
 * still be found (and removed) instead of leaking a second set that logs every event twice.
 */
const DETACH_KEY = '__vidoraxDebugLogDetach';
const handles = globalThis as unknown as Record<string, (() => void) | null | undefined>;

export function isDebugLogRunning(): boolean {
  return handles[DETACH_KEY] != null;
}

export function startDebugLog(): void {
  if (handles[DETACH_KEY]) {
    return;
  }
  const subscriptions: (() => void)[] = [];
  subscriptions.push(
    subscribePipelineOutcomes((entry) => {
      debugLog.add(
        'pipeline',
        `${entry.stage} ${entry.outcome}${entry.reason ? ` (${entry.reason})` : ''}` +
          `${entry.pageHost ? ` page=${entry.pageHost}` : ''}${entry.mediaHost ? ` media=${entry.mediaHost}` : ''}`,
        entry.at,
      );
    }),
  );
  const engine = getV2Engine();
  if (engine) {
    const stateSub = engine.addListener('onDownloadStateChange', ({ record }) => {
      debugLog.add(
        'download',
        `${record.id.slice(0, 8)} ${record.state} site=${record.site}` +
          `${record.errorCode ? ` error=${record.errorCode}` : ''} attempts=${record.attempts}`,
      );
    });
    subscriptions.push(() => stateSub.remove());
  }
  debugLog.add('debug-log', 'started');
  handles[DETACH_KEY] = () => {
    for (const unsubscribe of subscriptions) {
      try {
        unsubscribe();
      } catch {
        // already gone
      }
    }
  };
}

export function stopDebugLog(): void {
  const detach = handles[DETACH_KEY];
  if (!detach) {
    return;
  }
  detach();
  handles[DETACH_KEY] = null;
  debugLog.clear();
}
