import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';

import { brightnessFromSwipe, levelToPercent } from './brightness-state';
import { levelFromSwipeDelta } from './level-gesture';
import type { PlayerBrightnessState } from './hooks/use-player-brightness';
import type { PlayerVolumeState } from './hooks/use-player-volume';
import { clampVolume } from './volume-state';

export const ADJUSTMENT_HUD_HIDE_MS = 1200;

export type PlayerSideGestureKind = 'brightness' | 'volume';

export type PlayerAdjustmentHudState = {
  kind: PlayerSideGestureKind | null;
  percent: number;
  visible: boolean;
};

type VolumeFallback = {
  getLevel: () => number;
  setLevel: (level: number) => void;
};

type UsePlayerSideGesturesOptions = {
  surfaceHeight: number;
  brightness: PlayerBrightnessState;
  volume: PlayerVolumeState;
  volumeFallback?: VolumeFallback;
};

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

export function usePlayerSideGestures(
  options: UsePlayerSideGesturesOptions,
): {
  hud: PlayerAdjustmentHudState;
  brightnessAvailable: boolean;
  onBrightnessPanBegin: () => void;
  onBrightnessPanUpdate: (translationY: number) => void;
  onBrightnessPanEnd: () => void;
  onVolumePanBegin: () => void;
  onVolumePanUpdate: (translationY: number) => void;
  onVolumePanEnd: () => void;
} {
  const { brightness, volume, volumeFallback } = options;

  const [hud, setHud] = useState<PlayerAdjustmentHudState>({
    kind: null,
    percent: 0,
    visible: false,
  });

  const startLevelRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHapticRef = useRef<number | null>(null);
  const activeKindRef = useRef<PlayerSideGestureKind | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      setHud({ kind: null, percent: 0, visible: false });
      activeKindRef.current = null;
      lastHapticRef.current = null;
      brightness.endInteraction();
      volume.endInteraction();
    }, ADJUSTMENT_HUD_HIDE_MS);
  }, [brightness, clearHideTimer, volume]);

  useEffect(() => clearHideTimer, [clearHideTimer]);

  const showHud = useCallback((kind: PlayerSideGestureKind, level: number) => {
    setHud({
      kind,
      percent: levelToPercent(level),
      visible: true,
    });
    lastHapticRef.current = maybeBoundaryHaptic(level, lastHapticRef.current);
  }, []);

  const writeVolumeLevel = useCallback(
    (level: number) => {
      if (volume.available) {
        volume.setLevel(level);
        return;
      }
      volumeFallback?.setLevel(level);
    },
    [volume, volumeFallback],
  );

  const onBrightnessPanBegin = useCallback(() => {
    if (!brightness.available) {
      return;
    }
    clearHideTimer();
    activeKindRef.current = 'brightness';
    brightness.beginInteraction();
    void brightness.refresh().then((level) => {
      startLevelRef.current = level;
      showHud('brightness', level);
    });
  }, [brightness, clearHideTimer, showHud]);

  const onBrightnessPanUpdate = useCallback(
    (translationY: number) => {
      if (!brightness.available || activeKindRef.current !== 'brightness') {
        return;
      }
      const next = brightnessFromSwipe(
        startLevelRef.current,
        translationY,
        options.surfaceHeight,
      );
      brightness.setLevel(next);
      showHud('brightness', next);
    },
    [brightness, options.surfaceHeight, showHud],
  );

  const onBrightnessPanEnd = useCallback(() => {
    if (activeKindRef.current === 'brightness') {
      activeKindRef.current = null;
      brightness.endInteraction();
      scheduleHide();
    }
  }, [brightness, scheduleHide]);

  const onVolumePanBegin = useCallback(() => {
    clearHideTimer();
    activeKindRef.current = 'volume';
    volume.beginInteraction();
    void volume.refresh().then((level) => {
      startLevelRef.current = level;
      showHud('volume', level);
    });
  }, [clearHideTimer, showHud, volume]);

  const onVolumePanUpdate = useCallback(
    (translationY: number) => {
      if (activeKindRef.current !== 'volume') {
        return;
      }
      const next = levelFromSwipeDelta(
        startLevelRef.current,
        translationY,
        options.surfaceHeight,
        (value) => clampVolume(value) ?? 0,
      );
      writeVolumeLevel(next);
      showHud('volume', next);
    },
    [options.surfaceHeight, showHud, writeVolumeLevel],
  );

  const onVolumePanEnd = useCallback(() => {
    if (activeKindRef.current === 'volume') {
      activeKindRef.current = null;
      volume.endInteraction();
      scheduleHide();
    }
  }, [scheduleHide, volume]);

  return {
    hud,
    brightnessAvailable: brightness.available,
    onBrightnessPanBegin,
    onBrightnessPanUpdate,
    onBrightnessPanEnd,
    onVolumePanBegin,
    onVolumePanUpdate,
    onVolumePanEnd,
  };
}
