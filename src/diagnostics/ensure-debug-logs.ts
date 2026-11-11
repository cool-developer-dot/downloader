import { useSettingsStore } from '@/store/settings';

import { startDebugLog, stopDebugLog } from './debug-log-sources';

let attached = false;

/** Starts or stops the Debug Logs buffer with its setting (off by default). Idempotent. */
export function ensureDebugLogs(): void {
  if (attached) {
    return;
  }
  attached = true;
  const apply = (enabled: boolean) => (enabled ? startDebugLog() : stopDebugLog());
  apply(useSettingsStore.getState().debugLogs);
  const unsubscribe = useSettingsStore.subscribe((state, previous) => {
    if (state.debugLogs !== previous.debugLogs) {
      apply(state.debugLogs);
    }
  });
  // A Fast Refresh re-runs this module: drop the subscription an earlier copy made.
  const handles = globalThis as unknown as Record<string, (() => void) | undefined>;
  handles[SETTINGS_KEY]?.();
  handles[SETTINGS_KEY] = unsubscribe;
}

const SETTINGS_KEY = '__vidoraxDebugLogSettings';
