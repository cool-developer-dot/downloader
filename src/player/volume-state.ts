/**
 * Volume helpers — player gain state plus Android media volume UI sync.
 */

export function clampVolume(volume: number): number | null {
  if (!Number.isFinite(volume)) {
    return null;
  }
  return Math.max(0, Math.min(1, volume));
}

export type VolumeMuteState = {
  volume: number;
  isMuted: boolean;
  previousNonZeroVolume: number;
};

export function createInitialVolumeState(
  volume = 1,
): VolumeMuteState {
  const clamped = clampVolume(volume) ?? 1;
  return {
    volume: clamped,
    isMuted: false,
    previousNonZeroVolume: clamped > 0 ? clamped : 1,
  };
}

/** Mute while remembering last audible level. */
export function applyMute(state: VolumeMuteState): VolumeMuteState {
  return {
    ...state,
    isMuted: true,
    previousNonZeroVolume:
      state.volume > 0 ? state.volume : state.previousNonZeroVolume,
  };
}

/** Unmute and restore previous non-zero volume when current is 0. */
export function applyUnmute(state: VolumeMuteState): VolumeMuteState {
  const restored =
    state.volume > 0 ? state.volume : state.previousNonZeroVolume;
  const volume = clampVolume(restored) ?? 1;
  return {
    volume: volume > 0 ? volume : 1,
    isMuted: false,
    previousNonZeroVolume: volume > 0 ? volume : state.previousNonZeroVolume,
  };
}

export function applyVolumeChange(
  state: VolumeMuteState,
  nextVolume: number,
): VolumeMuteState | null {
  const volume = clampVolume(nextVolume);
  if (volume == null) {
    return null;
  }
  return {
    volume,
    isMuted: volume === 0,
    previousNonZeroVolume:
      volume > 0 ? volume : state.previousNonZeroVolume,
  };
}
