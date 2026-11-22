/**
 * P1 #531 Frame by Frame: one step is one frame of the playing video track. expo-video has no frame-step call, so a
 * step is an exact seek (the player's seek tolerance stays at its default, 0) into the neighbouring frame.
 */

/** Used when the track does not say (some containers and streams): the common video rate. */
export const FALLBACK_FRAME_RATE = 30;

const MAX_FRAME_RATE = 240;

/** Taps closer together than this continue from the last target, not from a player time that has not caught up. */
export const FRAME_STEP_CHAIN_MS = 800;

export type FrameStepDirection = -1 | 1;

const GRID_EPSILON = 1e-3;

export function frameDurationSeconds(frameRate: number | null | undefined): number {
  const rate =
    frameRate != null && Number.isFinite(frameRate) && frameRate >= 1 && frameRate <= MAX_FRAME_RATE
      ? frameRate
      : FALLBACK_FRAME_RATE;
  return 1 / rate;
}

export type FrameStep = {
  /** Where to seek: the middle of the frame, so an exact seek shows that frame whatever the container's rounding. */
  seekSeconds: number;
  /** The frame's own start time, shown in the frame panel. */
  frameStartSeconds: number;
  /** 0-based frame number on the track's frame grid. */
  frameIndex: number;
};

/**
 * One step from `fromSeconds`: the next (or previous) frame on the track's frame grid. Steps are counted in frames,
 * so they never drift; the first frame is the floor and the video's end the ceiling. Null when the time is unknown.
 */
export function frameStep(
  fromSeconds: number,
  direction: FrameStepDirection,
  frameRate: number | null | undefined,
  durationSeconds: number | null | undefined,
): FrameStep | null {
  if (!Number.isFinite(fromSeconds) || fromSeconds < 0) {
    return null;
  }
  const rate = 1 / frameDurationSeconds(frameRate);
  // A hair of tolerance so a frame start that is not exact in floating point (10 s at 30 fps) counts as that frame.
  let frameIndex = Math.max(0, Math.floor(fromSeconds * rate + GRID_EPSILON) + direction);
  const knownDuration = durationSeconds != null && Number.isFinite(durationSeconds) && durationSeconds > 0;
  if (knownDuration) {
    frameIndex = Math.min(frameIndex, Math.max(0, Math.ceil(durationSeconds * rate - GRID_EPSILON) - 1));
  }
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  const seek = (frameIndex + 0.5) / rate;
  return {
    seekSeconds: round(knownDuration ? Math.min(seek, durationSeconds) : seek),
    frameStartSeconds: round(frameIndex / rate),
    frameIndex,
  };
}

/** The frame showing at `seconds` (for the panel when it opens): its number and start time; null when unknown. */
export function frameAt(
  seconds: number,
  frameRate: number | null | undefined,
): Pick<FrameStep, 'frameIndex' | 'frameStartSeconds'> | null {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  const rate = 1 / frameDurationSeconds(frameRate);
  const frameIndex = Math.floor(seconds * rate + GRID_EPSILON);
  return { frameIndex, frameStartSeconds: Math.round((frameIndex / rate) * 1e6) / 1e6 };
}

/**
 * The time a step starts from: the previous step's target while the taps keep coming (the player may still be
 * seeking there), otherwise the player's own current time.
 */
export function frameStepBase(
  playerSeconds: number,
  last: { target: number; at: number } | null,
  now: number,
): number {
  if (last && now - last.at >= 0 && now - last.at < FRAME_STEP_CHAIN_MS) {
    return last.target;
  }
  return playerSeconds;
}

/** 01:24.033 / 1:02:03.500: the playback time with milliseconds, for the frame panel. */
export function formatFrameTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
    return '--:--.---';
  }
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const total = Math.floor(totalMs / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const tail = `${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${tail}` : `${String(m).padStart(2, '0')}:${tail}`;
}
