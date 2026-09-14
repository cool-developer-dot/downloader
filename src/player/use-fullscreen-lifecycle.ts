/**
 * Fullscreen lifecycle — preserves the same player instance.
 * Uses in-app immersive layout (not VideoView.enterFullscreen) because
 * Android pauses the JS runtime in native video fullscreen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { playerLog } from './diagnostics';
import {
  beginEnterFullscreen,
  beginExitFullscreen,
  completeEnterFullscreen,
  completeExitFullscreen,
  initialFullscreenState,
  resolveAndroidBackAction,
  type FullscreenMachineState,
} from './fullscreen-state';
import {
  enterFullscreenOrientation,
  exitFullscreenOrientation,
  restoreOrientation,
} from './orientation-controller';
import { ensurePlayerChromeRuntime } from './player-chrome.runtime';
import {
  enterImmersiveSystemBars,
  exitImmersiveSystemBars,
  restoreSystemBars,
} from './system-bars';

export type UseFullscreenLifecycleResult = {
  isFullscreen: boolean;
  phase: FullscreenMachineState['phase'];
  enterFullscreen: () => Promise<void>;
  exitFullscreen: () => Promise<void>;
  toggleFullscreen: () => Promise<void>;
  /** Restore orientation + bars without requiring fullscreen flag. */
  restorePresentation: () => Promise<void>;
  handleAndroidBack: () => 'exit_fullscreen' | 'leave_player';
};

export function useFullscreenLifecycle(): UseFullscreenLifecycleResult {
  ensurePlayerChromeRuntime();
  const [state, setState] = useState<FullscreenMachineState>(
    initialFullscreenState,
  );
  const stateRef = useRef(state);
  const busyRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    return () => {
      void restoreOrientation();
      void restoreSystemBars();
    };
  }, []);

  // After background interrupt, re-assert immersive chrome if still fullscreen.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || !stateRef.current.isFullscreen) {
        return;
      }
      void (async () => {
        try {
          await enterFullscreenOrientation();
          await enterImmersiveSystemBars();
        } catch {
          // ignore — restore path handles catastrophic failure
        }
      })();
    });
    return () => sub.remove();
  }, []);

  const enterFullscreen = useCallback(async () => {
    if (busyRef.current) {
      return;
    }
    const next = beginEnterFullscreen(stateRef.current);
    if (!next) {
      return;
    }
    busyRef.current = true;
    setState(next);
    try {
      await enterFullscreenOrientation();
      await enterImmersiveSystemBars();
      setState(completeEnterFullscreen(next));
      playerLog('player.fullscreen_enter');
    } catch {
      await restoreOrientation();
      await restoreSystemBars();
      setState(completeExitFullscreen());
    } finally {
      busyRef.current = false;
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    if (busyRef.current) {
      return;
    }
    const next = beginExitFullscreen(stateRef.current);
    if (!next) {
      // Still force restore if flag is inconsistent.
      if (!stateRef.current.isFullscreen) {
        return;
      }
    }
    busyRef.current = true;
    if (next) {
      setState(next);
    }
    try {
      await exitImmersiveSystemBars();
      await exitFullscreenOrientation();
      playerLog('player.fullscreen_exit');
    } finally {
      setState(completeExitFullscreen());
      busyRef.current = false;
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (stateRef.current.isFullscreen) {
      await exitFullscreen();
    } else {
      await enterFullscreen();
    }
  }, [enterFullscreen, exitFullscreen]);

  const restorePresentation = useCallback(async () => {
    // Idempotent: safe to call repeatedly from error/back/unmount paths.
    try {
      await restoreSystemBars();
    } catch {
      // ignore
    }
    try {
      await restoreOrientation();
    } catch {
      // ignore
    }
    setState(completeExitFullscreen());
    busyRef.current = false;
  }, []);

  const handleAndroidBack = useCallback((): 'exit_fullscreen' | 'leave_player' => {
    const action = resolveAndroidBackAction(stateRef.current.isFullscreen);
    if (action === 'exit_fullscreen') {
      void exitFullscreen();
    }
    return action;
  }, [exitFullscreen]);

  return {
    isFullscreen: state.isFullscreen,
    phase: state.phase,
    enterFullscreen,
    exitFullscreen,
    toggleFullscreen,
    restorePresentation,
    handleAndroidBack,
  };
}
