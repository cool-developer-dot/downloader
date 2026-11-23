import type { VideoPlayer } from 'expo-video';

/**
 * The `VidoraPlayer` native module (VidoraPlayerModule.kt): Faran's Player packages P14–P19 reach expo-video's
 * ExoPlayer through it — the settings expo-video's own JavaScript API has no property for. Every call takes the
 * expo-video player it acts on and runs on Android's main thread. Calls on a released player do nothing.
 */

/** P14 #670: the size of the video track playing now (an adaptive stream changes it with the connection). */
export type PlayingVideoSize = { width: number; height: number; bitrate: number };

/** P15 #661 / #701: a media session's ⏭ / ⏮ (headset double press, a remote, the notification) for the Player's queue. */
export type QueueCommandEvent = { command: 'next' | 'previous' };

/** P19: the phone's equalizer (its bands and level range in millibels) and which effects it has. */
export type AudioEffectsInfo = {
  equalizer: boolean;
  bands: { centerHz: number; minMb: number; maxMb: number }[];
  bassBoost: boolean;
  virtualizer: boolean;
};

export type VidoraPlayerEvents = {
  onQueueCommand: (event: QueueCommandEvent) => void;
  /** P18 #644 / #730: the countdown set by `setPlaybackDeadline` ran out (the video faded out and paused). */
  onPlaybackDeadline: () => void;
};

export interface VidoraPlayerModuleApi {
  /**
   * P14 #670 / P17 #574: the longest video side the player may pick (null = any; HLS / DASH adapt below it) and
   * whether video is decoded at all (false = Audio Only Mode).
   */
  setTrackLimits(player: VideoPlayer, maxLongSide: number | null, videoDisabled: boolean): Promise<void>;
  /** P14 #670: the playing video track's size; null before one is known. */
  getPlayingVideoSize(player: VideoPlayer): Promise<PlayingVideoSize | null>;
  /**
   * P15 #661 / #701: whether the player's media sessions offer ⏭ / ⏮ for the Player's queue (`onQueueCommand`).
   * Off: the sessions keep expo-video's own commands. ⏮ is offered whenever the video can seek (to its start).
   */
  setQueueNavigation(player: VideoPlayer, enabled: boolean, hasNext: boolean, hasPrevious: boolean): Promise<void>;
  /**
   * P17 #554: the sound later (+) or earlier (−) than the picture, in ms (clamped to ±3000), kept the same in real
   * time at `speed`. Applied by the player's VidoraAudioProcessor; again after every seek.
   */
  setAudioDelay(player: VideoPlayer, delayMs: number, speed: number): Promise<void>;
  /**
   * P18 #644 / #730: `inMs` from now the sound fades out over `fadeMs` and the player pauses (its volume is then put
   * back), and `onPlaybackDeadline` fires; null cancels. Native, so it runs with the screen off.
   */
  setPlaybackDeadline(player: VideoPlayer, inMs: number | null, fadeMs: number): Promise<void>;
  /**
   * P19 #555 mono, #556 balance (−1 … 1), #557 night mode, #558 normalization, #548 volume boost (100–200 %): the
   * player's own PCM (VidoraAudioProcessor), limited so it never clips.
   */
  setSoundShaping(
    player: VideoPlayer,
    mono: boolean,
    balance: number,
    nightMode: boolean,
    normalize: boolean,
    boostPercent: number,
  ): Promise<void>;
  /** P19 #549 / #551 / #552: Android's equalizer (millibels per device band), bass boost and virtualizer (0–1000). */
  setAudioEffects(
    player: VideoPlayer,
    eqEnabled: boolean,
    bandLevelsMb: number[],
    bassStrength: number,
    virtualizerStrength: number,
  ): Promise<void>;
  /** Releases what the module keeps for the player (effects, countdown, session player); the session calls it last. */
  releasePlayer(player: VideoPlayer): Promise<void>;
  /** P19: the phone's equalizer bands and which effects it has. */
  describeAudioEffects(player: VideoPlayer): Promise<AudioEffectsInfo>;
  /** P15 #560: pause when headphones are unplugged or a Bluetooth headset disconnects. */
  setPauseWhenAudioBecomesNoisy(player: VideoPlayer, enabled: boolean): Promise<void>;
  /** P15 #703: show the app's window over the lock screen; false when there is no activity. */
  setShowWhenLocked(show: boolean): Promise<boolean>;
  /** P15 #703: the phone is locked (its lock screen is up). */
  isDeviceLocked(): Promise<boolean>;
  /** P15 #703: asks for the phone's unlock (PIN, pattern, fingerprint); true once unlocked. */
  requestUnlock(): Promise<boolean>;
}
