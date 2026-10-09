import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { createAdjustmentHud, type AdjustmentHud } from './adjustment-hud';
import { brightnessFromSwipe, levelToPercent } from './brightness-state';
import { levelFromSwipeDelta } from './level-gesture';
import type { PlayerBrightnessState } from './hooks/use-player-brightness';
import type { PlayerVolumeState } from './hooks/use-player-volume';
import { clampVolume } from './volume-state';

export { ADJUSTMENT_HUD_HIDE_MS } from './adjustment-hud';

export type PlayerSideGestureKind = 'brightness' | 'volume';

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

export type PlayerSideGestures = {
  /** The indicator's store — read by `PlayerAdjustmentHud` alone, so a swipe never re-renders the screen. */
  hud: AdjustmentHud;
  brightnessAvailable: boolean;
  /** The swipe was recognised (not a tap): the value starts following the finger. */
  onBrightnessPanStart: () => void;
  onBrightnessPanUpdate: (translationY: number) => void;
  /** Every gesture that began ends here — recognised or not, finished or cancelled. */
  onBrightnessPanFinalize: () => void;
  onVolumePanStart: () => void;
  onVolumePanUpdate: (translationY: number) => void;
  onVolumePanFinalize: () => void;
  /** Pinch zoom reports its level through the same indicator. */
  onZoomChange: (percent: number) => void;
  onZoomFinalize: () => void;
};

/**
 * Brightness (left edge) and volume (right edge) swipes. The indicator appears only once a swipe actually changes a
 * value, follows it, and hides `ADJUSTMENT_HUD_HIDE_MS` after the finger lifts. Callbacks are stable for the life of
 * the screen, so the gesture recognisers are not rebuilt on every level change.
 */
export function usePlayerSideGestures(options: UsePlayerSideGesturesOptions): PlayerSideGestures {
  const [hud] = useState(() => createAdjustmentHud());
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const startLevelRef = useRef(0);
  const activeKindRef = useRef<PlayerSideGestureKind | null>(null);

  useEffect(() => () => hud.dispose(), [hud]);

  const currentVolumeLevel = useCallback((): number => {
    const { volume, volumeFallback } = optionsRef.current;
    if (volume.available) {
      return volume.level;
    }
    return volumeFallback?.getLevel() ?? volume.level;
  }, []);

  const writeVolumeLevel = useCallback((level: number) => {
    const { volume, volumeFallback } = optionsRef.current;
    if (volume.available) {
      volume.setLevel(level);
      return;
    }
    volumeFallback?.setLevel(level);
  }, []);

  const finishInteraction = useCallback(
    (kind: PlayerSideGestureKind) => {
      if (activeKindRef.current !== kind) {
        return;
      }
      activeKindRef.current = null;
      const { brightness, volume } = optionsRef.current;
      if (kind === 'brightness') {
        brightness.endInteraction();
      } else {
        volume.endInteraction();
      }
      hud.release();
    },
    [hud],
  );

  const onBrightnessPanStart = useCallback(() => {
    const { brightness } = optionsRef.current;
    if (!brightness.available) {
      return;
    }
    activeKindRef.current = 'brightness';
    brightness.beginInteraction();
    // The level the hook already follows (read when the player opened and on every return to the foreground):
    // reading the system again here would make the first frames of the swipe jump.
    startLevelRef.current = brightness.level;
    hud.show('brightness', levelToPercent(brightness.level));
  }, [hud]);

  const onBrightnessPanUpdate = useCallback(
    (translationY: number) => {
      const { brightness, surfaceHeight } = optionsRef.current;
      if (!brightness.available || activeKindRef.current !== 'brightness') {
        return;
      }
      const next = brightnessFromSwipe(startLevelRef.current, translationY, surfaceHeight);
      brightness.setLevel(next);
      hud.show('brightness', levelToPercent(next));
    },
    [hud],
  );

  const onBrightnessPanFinalize = useCallback(() => finishInteraction('brightness'), [finishInteraction]);

  const onVolumePanStart = useCallback(() => {
    const { volume } = optionsRef.current;
    activeKindRef.current = 'volume';
    volume.beginInteraction();
    startLevelRef.current = currentVolumeLevel();
    hud.show('volume', levelToPercent(startLevelRef.current));
  }, [currentVolumeLevel, hud]);

  const onVolumePanUpdate = useCallback(
    (translationY: number) => {
      if (activeKindRef.current !== 'volume') {
        return;
      }
      const next = levelFromSwipeDelta(
        startLevelRef.current,
        translationY,
        optionsRef.current.surfaceHeight,
        (value) => clampVolume(value) ?? 0,
      );
      writeVolumeLevel(next);
      hud.show('volume', levelToPercent(next));
    },
    [hud, writeVolumeLevel],
  );

  const onVolumePanFinalize = useCallback(() => finishInteraction('volume'), [finishInteraction]);

  const onZoomChange = useCallback(
    (percent: number) => {
      hud.show('zoom', percent);
    },
    [hud],
  );

  const onZoomFinalize = useCallback(() => {
    if (hud.getSnapshot().kind === 'zoom') {
      hud.release();
    }
  }, [hud]);

  return {
    hud,
    brightnessAvailable: options.brightness.available,
    onBrightnessPanStart,
    onBrightnessPanUpdate,
    onBrightnessPanFinalize,
    onVolumePanStart,
    onVolumePanUpdate,
    onVolumePanFinalize,
    onZoomChange,
    onZoomFinalize,
  };
}
