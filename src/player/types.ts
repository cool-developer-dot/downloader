/**
 * Week 8 Day 2 Stage 1 — player domain types.
 * Session state is screen-local; high-frequency progress never hits global Zustand.
 */

export type PlayerErrorCode =
  | 'MEDIA_NOT_FOUND'
  | 'FILE_UNAVAILABLE'
  | 'SOURCE_RESOLUTION_FAILED'
  | 'UNSUPPORTED_MEDIA'
  | 'CORRUPT_MEDIA'
  | 'PERMISSION_DENIED'
  | 'PLAYER_INIT_FAILED'
  | 'PLAYBACK_FAILED'
  | 'PREPARATION_TIMEOUT';

/** Internal playback source — URI never crosses navigation/props boundaries. */
export type PlaybackSource = {
  mediaId: string;
  uri: string;
  displayName: string;
  mimeType: string | null;
};

export type PlayerSessionPhase =
  | 'resolving'
  | 'preparing'
  | 'ready'
  | 'seeking'
  | 'error';

export type PlayerSessionState = {
  mediaId: string | null;
  displayName: string | null;
  positionSeconds: number;
  durationSeconds: number | null;
  isPlaying: boolean;
  isReady: boolean;
  /**
   * True only after the native VideoView has painted the first frame for the
   * current armed load. readyToPlay alone is not sufficient to drop the cover.
   */
  hasFirstFrame: boolean;
  /**
   * True after composition-synced reveal following hasFirstFrame.
   * Cover stays opaque until this flips — never fades in the same turn as
   * onFirstFrameRender.
   */
  isSurfaceRevealed: boolean;
  isLoading: boolean;
  isSeeking: boolean;
  isCompleted: boolean;
  playbackRate: number;
  volume: number;
  isMuted: boolean;
  phase: PlayerSessionPhase;
  error: PlayerErrorCode | null;
  errorMessage: string | null;
  /** Stage 2 chrome flag — mirrored from fullscreen lifecycle when needed. */
  fullscreen: boolean;
};

export type PlayerController = {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => void;
  seekBy: (deltaSeconds: number) => void;
  setPlaybackRate: (rate: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  dispose: () => void;
};

export const SEEK_STEP_SECONDS = 10;
export const PROGRESS_INTERVAL_SECONDS = 0.35;

export const initialPlayerSessionState: PlayerSessionState = {
  mediaId: null,
  displayName: null,
  positionSeconds: 0,
  durationSeconds: null,
  isPlaying: false,
  isReady: false,
  hasFirstFrame: false,
  isSurfaceRevealed: false,
  isLoading: true,
  isSeeking: false,
  isCompleted: false,
  playbackRate: 1,
  volume: 1,
  isMuted: false,
  phase: 'resolving',
  error: null,
  errorMessage: null,
  fullscreen: false,
};
