import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAppLockStore } from './app-lock.store';

/**
 * Locks immediately when the app leaves the active foreground while App Lock is enabled.
 * Separate from the download AppState bus — UI privacy only.
 */
export function useAppLockLifecycle(): void {
  const lock = useAppLockStore((s) => s.lock);
  const isEnabled = useAppLockStore((s) => s.isEnabled);
  const isBootstrapped = useAppLockStore((s) => s.isBootstrapped);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (!isBootstrapped || !isEnabled) {
      return;
    }

    const onChange = (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev === 'active' && next !== 'active') {
        lock();
      }
    };

    const sub = AppState.addEventListener('change', onChange);
    return () => {
      sub.remove();
    };
  }, [isBootstrapped, isEnabled, lock]);
}
