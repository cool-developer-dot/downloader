/**
 * Fullscreen Back priority + transition guards (pure).
 */

export type FullscreenPhase = 'inline' | 'entering' | 'fullscreen' | 'exiting';

export type FullscreenMachineState = {
  isFullscreen: boolean;
  phase: FullscreenPhase;
};

export const initialFullscreenState: FullscreenMachineState = {
  isFullscreen: false,
  phase: 'inline',
};

export function beginEnterFullscreen(
  state: FullscreenMachineState,
): FullscreenMachineState | null {
  if (state.isFullscreen || state.phase === 'entering' || state.phase === 'exiting') {
    return null;
  }
  return { isFullscreen: false, phase: 'entering' };
}

export function completeEnterFullscreen(
  state: FullscreenMachineState,
): FullscreenMachineState {
  return { isFullscreen: true, phase: 'fullscreen' };
}

export function beginExitFullscreen(
  state: FullscreenMachineState,
): FullscreenMachineState | null {
  if (!state.isFullscreen || state.phase === 'entering' || state.phase === 'exiting') {
    return null;
  }
  return { isFullscreen: true, phase: 'exiting' };
}

export function completeExitFullscreen(): FullscreenMachineState {
  return { isFullscreen: false, phase: 'inline' };
}

/**
 * Android Back priority:
 * fullscreen → exit fullscreen (consume)
 * else → leave player (do not consume here; caller navigates)
 */
export function resolveAndroidBackAction(
  isFullscreen: boolean,
): 'exit_fullscreen' | 'leave_player' {
  return isFullscreen ? 'exit_fullscreen' : 'leave_player';
}
