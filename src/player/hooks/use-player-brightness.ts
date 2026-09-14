import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { clampBrightness, levelToPercent } from '@/player/brightness-state';
import { useBrightnessControl } from '@/player/use-brightness-control';

function maybeBoundaryHaptic(level: number, lastHaptic: number | null): number | null {
  const thresholds = [0, 0.5, 1];
  for (const threshold of thresholds) {
    if (lastHaptic === threshold) {
      continue;
    }
    if (Math.abs(level - threshold) <= 0.02) {
      void Haptics.selectionAsync().catch(() => {});
      return threshold;
    }
  }
  return lastHaptic;
}

export type PlayerBrightnessState = {
  available: boolean;
  level: number;
  percent: number;
  isInteracting: boolean;
  setLevel: (level: number) => void;
  beginInteraction: () => void;
  endInteraction: () => void;
  refresh: () => Promise<number>;
};

/**
 * Window brightness for the player with local UI state for gesture HUD sync.
 */
export function usePlayerBrightness(): PlayerBrightnessState {
  const control = useBrightnessControl();
  const [level, setLevelState] = useState(0.5);
  const [isInteracting, setIsInteracting] = useState(false);
  const lastHapticRef = useRef<number | null>(null);

  const refresh = useCallback(async (): Promise<number> => {
    if (!control.available) {
      return level;
    }
    const next = await control.readLevel();
    setLevelState(next);
    return next;
  }, [control, level]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh();
      }
    });
    return () => sub.remove();
  }, [refresh]);

  const setLevel = useCallback(
    (nextLevel: number) => {
      if (!control.available) {
        return;
      }
      const clamped = clampBrightness(nextLevel);
      setLevelState(clamped);
      lastHapticRef.current = maybeBoundaryHaptic(clamped, lastHapticRef.current);
      void control.setLevel(clamped);
    },
    [control],
  );

  const beginInteraction = useCallback(() => {
    setIsInteracting(true);
    lastHapticRef.current = null;
  }, []);

  const endInteraction = useCallback(() => {
    setIsInteracting(false);
    lastHapticRef.current = null;
  }, []);

  return {
    available: control.available,
    level,
    percent: levelToPercent(level),
    isInteracting,
    setLevel,
    beginInteraction,
    endInteraction,
    refresh,
  };
}
