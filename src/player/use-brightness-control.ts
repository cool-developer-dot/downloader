import * as Brightness from 'expo-brightness';
import { useCallback, useEffect, useRef, useState } from 'react';

import { clampBrightness } from './brightness-state';

export type BrightnessControl = {
  available: boolean;
  readLevel: () => Promise<number>;
  setLevel: (level: number) => Promise<boolean>;
};

/**
 * Window-level brightness for the player session.
 * Restores the captured level on unmount when possible.
 */
export function useBrightnessControl(): BrightnessControl {
  const [available, setAvailable] = useState(true);
  const savedLevelRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // Window brightness needs no permission — only *system* brightness does. Opening a video must never
        // drop the user on Android's "Modify system settings" screen.
        const current = await Brightness.getBrightnessAsync();
        if (mounted) {
          savedLevelRef.current = clampBrightness(current);
        }
      } catch {
        if (mounted) {
          setAvailable(false);
        }
      }
    })();

    return () => {
      mounted = false;
      const restore = savedLevelRef.current;
      if (restore != null && available) {
        void Brightness.setBrightnessAsync(restore).catch(() => {});
      }
    };
  }, [available]);

  const readLevel = useCallback(async (): Promise<number> => {
    if (!available) {
      return 0.5;
    }
    try {
      const value = await Brightness.getBrightnessAsync();
      return clampBrightness(value);
    } catch {
      return savedLevelRef.current ?? 0.5;
    }
  }, [available]);

  const setLevel = useCallback(
    async (level: number): Promise<boolean> => {
      if (!available) {
        return false;
      }
      try {
        await Brightness.setBrightnessAsync(clampBrightness(level));
        return true;
      } catch {
        return false;
      }
    },
    [available],
  );

  return { available, readLevel, setLevel };
}
