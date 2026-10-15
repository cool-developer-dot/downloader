/**
 * What feeds the Debug Logs buffer while it is on: the detection pipeline's own outcome ledger (hosts and hashes,
 * never URLs) and the v2 engine's state events (state and error code; no URLs). Subscriptions exist only while
 * Debug logs is on; turning it off unsubscribes and empties the buffer.
 */

import { getV2Engine } from '@/downloads/v2/engine-port';
import { subscribePipelineOutcomes } from '@/media-detection/pipeline/pipeline-outcome';

import { debugLog } from './debug-log';

let detach: (() => void) | null = null;

export function isDebugLogRunning(): boolean {
  return detach != null;
}

export function startDebugLog(): void {
  if (detach) {
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
  detach = () => {
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
  if (!detach) {
    return;
  }
  detach();
  detach = null;
  debugLog.clear();
}
