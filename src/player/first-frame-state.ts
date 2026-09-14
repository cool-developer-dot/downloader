/**
 * First-frame startup cover — pure helpers.
 *
 * readyToPlay ≠ first video pixels.
 * onFirstFrameRender means expo-video raised SurfaceView alpha and emitted JS,
 * but the painted frame may not yet be committed to the window in the same turn.
 * Cover stays fully opaque until a composition-synced reveal.
 */

export type FirstFrameStartupPhase =
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'first_frame'
  | 'composition_sync'
  | 'revealed'
  | 'error';

export type StartupRevealState = {
  hasFirstFrame: boolean;
  isSurfaceRevealed: boolean;
};

export function initialStartupRevealState(): StartupRevealState {
  return {
    hasFirstFrame: false,
    isSurfaceRevealed: false,
  };
}

export function shouldShowStartupCover(input: {
  isSurfaceRevealed: boolean;
  hasError: boolean;
}): boolean {
  if (input.hasError) {
    return false;
  }
  return !input.isSurfaceRevealed;
}

/**
 * Mid-playback buffering must not re-cover an already painted / revealed frame.
 */
export function shouldShowStartupCoverWhileBuffering(input: {
  hasFirstFrame: boolean;
  isSurfaceRevealed: boolean;
  isBuffering: boolean;
  hasError: boolean;
}): boolean {
  if (input.hasFirstFrame || input.isSurfaceRevealed) {
    return false;
  }
  return shouldShowStartupCover({
    isSurfaceRevealed: input.isSurfaceRevealed,
    hasError: input.hasError,
  });
}

/**
 * Native first-frame callback must not drop the cover in the same JS turn:
 * SurfaceView alpha→1 and window composition can lag one frame behind the event.
 */
export function shouldRevealSurfaceInSameTurnAsFirstFrameEvent(): boolean {
  return false;
}

export function canAcceptFirstFrameEvent(input: {
  mounted: boolean;
  loadArmed: boolean;
  armedGeneration: number;
  currentGeneration: number;
  activeMediaId: string | null;
}): boolean {
  if (!input.mounted || !input.loadArmed) {
    return false;
  }
  if (input.armedGeneration !== input.currentGeneration) {
    return false;
  }
  return input.activeMediaId != null;
}

export function applyFirstFrameAccepted(
  prev: StartupRevealState,
): StartupRevealState {
  if (prev.hasFirstFrame) {
    return prev;
  }
  return {
    ...prev,
    hasFirstFrame: true,
    // Cover stays until composition-synced reveal.
    isSurfaceRevealed: false,
  };
}

/**
 * Reveal exactly once after composition sync. Idempotent.
 */
export function applySurfaceReveal(prev: StartupRevealState): StartupRevealState {
  if (!prev.hasFirstFrame || prev.isSurfaceRevealed) {
    return prev;
  }
  return {
    ...prev,
    isSurfaceRevealed: true,
  };
}

export function resetFirstFrameForNewSource(): StartupRevealState {
  return initialStartupRevealState();
}

export type FrameScheduler = (cb: () => void) => { cancel: () => void };

/**
 * Schedule cover reveal on the next UI frame after first-frame acceptance.
 * This is render synchronization with Android composition — not a timing hack.
 */
export function scheduleCompositionSyncedReveal(options: {
  scheduleFrame: FrameScheduler;
  isStillValid: () => boolean;
  onReveal: () => void;
}): { cancel: () => void } {
  return options.scheduleFrame(() => {
    if (!options.isStillValid()) {
      return;
    }
    options.onReveal();
  });
}

export function createRequestAnimationFrameScheduler(
  raf: (cb: () => void) => number = requestAnimationFrame,
  caf: (id: number) => void = cancelAnimationFrame,
): FrameScheduler {
  return (cb) => {
    const id = raf(() => {
      cb();
    });
    return {
      cancel: () => {
        caf(id);
      },
    };
  };
}

/**
 * Same URI must not trigger another replace for an already-armed load.
 */
export function shouldAssignPlaybackSource(input: {
  nextUri: string;
  lastAssignedUri: string | null;
  generation: number;
  lastAssignedGeneration: number | null;
}): boolean {
  if (!input.nextUri) {
    return false;
  }
  if (
    input.lastAssignedUri === input.nextUri &&
    input.lastAssignedGeneration === input.generation
  ) {
    return false;
  }
  return true;
}
