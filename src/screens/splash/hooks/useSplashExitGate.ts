import { useEffect, useRef } from 'react';

type UseSplashExitGateOptions = {
  /** App bootstrap finished (stores hydrated, session restored). */
  isInitializationComplete: boolean;
  /** Minimum splash visibility before exit may start. */
  minVisibleMs: number;
  /** Called once when both gate conditions are met. */
  onReadyToExit: () => void;
  enabled?: boolean;
};

/**
 * Exit only when BOTH are true:
 * 1. App initialization is complete
 * 2. At least minVisibleMs have elapsed since mount
 *
 * If init finishes early, animation continues until the minimum.
 * If init runs long, splash stays until init completes (then exits).
 */
export function useSplashExitGate({
  isInitializationComplete,
  minVisibleMs,
  onReadyToExit,
  enabled = true,
}: UseSplashExitGateOptions): void {
  const mountedAtRef = useRef<number | null>(null);
  const hasFiredRef = useRef(false);
  const onReadyToExitRef = useRef(onReadyToExit);

  useEffect(() => {
    onReadyToExitRef.current = onReadyToExit;
  }, [onReadyToExit]);

  useEffect(() => {
    if (mountedAtRef.current === null) {
      mountedAtRef.current = Date.now();
    }
  }, []);

  useEffect(() => {
    if (!enabled || hasFiredRef.current) {
      return;
    }

    if (!isInitializationComplete) {
      return;
    }

    const mountedAt = mountedAtRef.current ?? Date.now();
    const remaining = Math.max(0, minVisibleMs - (Date.now() - mountedAt));

    const timeoutId = setTimeout(() => {
      if (hasFiredRef.current) {
        return;
      }
      hasFiredRef.current = true;
      onReadyToExitRef.current();
    }, remaining);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [enabled, isInitializationComplete, minVisibleMs]);
}
