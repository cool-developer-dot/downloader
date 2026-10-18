import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAppLockStore } from './app-lock.store';
import { createAppLockLeaveController, isExpectingSystemScreen } from './expected-system-screen';

/**
 * Locks immediately when the app leaves the active foreground while App Lock is enabled — except while a system
 * picker or permission prompt VidoraX opened itself is in front: then a return within 30 seconds stays unlocked
 * (`expected-system-screen.ts`). Separate from the download AppState bus — UI privacy only.
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

    const controller = createAppLockLeaveController({
      lock,
      isExpecting: isExpectingSystemScreen,
      now: Date.now,
      schedule: (run, ms) => setTimeout(run, ms),
      clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });

    const onChange = (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      controller.onChange(prev, next);
    };

    const sub = AppState.addEventListener('change', onChange);
    return () => {
      sub.remove();
      controller.dispose();
    };
  }, [isBootstrapped, isEnabled, lock]);
}
