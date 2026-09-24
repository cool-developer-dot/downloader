import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  readAndroidMediaVolume,
  subscribeAndroidMediaVolume,
  writeAndroidMediaVolume,
} from '@/player/adapters/android-media-volume.adapter';
import { levelToPercent } from '@/player/brightness-state';
import { clampVolume } from '@/player/volume-state';

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

export type PlayerVolumeState = {
  available: boolean;
  level: number;
  percent: number;
  isMuted: boolean;
  isInteracting: boolean;
  setLevel: (level: number) => void;
  toggleMute: () => void;
  beginInteraction: () => void;
  endInteraction: () => void;
  refresh: () => Promise<number>;
};

/**
 * Android STREAM_MUSIC volume for the player UI.
 */
export function usePlayerVolume(): PlayerVolumeState {
  const [available, setAvailable] = useState(false);
  const [level, setLevelState] = useState(1);
  const [isInteracting, setIsInteracting] = useState(false);
  const lastHapticRef = useRef<number | null>(null);
  const writingRef = useRef(false);
  const previousNonZeroRef = useRef(1);

  const applySnapshot = useCallback((nextLevel: number) => {
    const clamped = clampVolume(nextLevel) ?? 0;
    if (clamped > 0) {
      previousNonZeroRef.current = clamped;
    }
    setLevelState(clamped);
    lastHapticRef.current = maybeBoundaryHaptic(clamped, lastHapticRef.current);
  }, []);

  const refresh = useCallback(async (): Promise<number> => {
    const snapshot = await readAndroidMediaVolume();
    setAvailable(snapshot.available);
    applySnapshot(snapshot.level);
    return clampVolume(snapshot.level) ?? 0;
  }, [applySnapshot]);

  // Follow the device's media volume: read it when the player opens and on every return to the
  // foreground, and listen for changes made with the hardware keys while it is open.
  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      void readAndroidMediaVolume().then((snapshot) => {
        if (cancelled) {
          return;
        }
        setAvailable(snapshot.available);
        applySnapshot(snapshot.level);
      });
    };
    sync();
    const unsubscribe = subscribeAndroidMediaVolume((snapshot) => {
      if (writingRef.current) {
        return;
      }
      setAvailable(snapshot.available);
      applySnapshot(snapshot.level);
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        sync();
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
      sub.remove();
    };
  }, [applySnapshot]);

  const setLevel = useCallback((nextLevel: number) => {
    const clamped = clampVolume(nextLevel);
    if (clamped == null) {
      return;
    }
    applySnapshot(clamped);
    writingRef.current = true;
    void writeAndroidMediaVolume(clamped).then((snapshot) => {
      writingRef.current = false;
      setAvailable(snapshot.available);
      applySnapshot(snapshot.level);
    });
  }, [applySnapshot]);

  const toggleMute = useCallback(() => {
    if (level === 0) {
      const restored =
        previousNonZeroRef.current > 0 ? previousNonZeroRef.current : 1;
      setLevel(restored);
      return;
    }
    previousNonZeroRef.current = level > 0 ? level : previousNonZeroRef.current;
    setLevel(0);
  }, [level, setLevel]);

  const beginInteraction = useCallback(() => {
    setIsInteracting(true);
    lastHapticRef.current = null;
  }, []);

  const endInteraction = useCallback(() => {
    setIsInteracting(false);
    lastHapticRef.current = null;
  }, []);

  return {
    available,
    level,
    percent: levelToPercent(level),
    isMuted: level === 0,
    isInteracting,
    setLevel,
    toggleMute,
    beginInteraction,
    endInteraction,
    refresh,
  };
}
