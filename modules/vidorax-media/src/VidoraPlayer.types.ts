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

export type VidoraPlayerEvents = {
  onQueueCommand: (event: QueueCommandEvent) => void;
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
  /** P15 #560: pause when headphones are unplugged or a Bluetooth headset disconnects. */
  setPauseWhenAudioBecomesNoisy(player: VideoPlayer, enabled: boolean): Promise<void>;
  /** P15 #703: show the app's window over the lock screen; false when there is no activity. */
  setShowWhenLocked(show: boolean): Promise<boolean>;
  /** P15 #703: the phone is locked (its lock screen is up). */
  isDeviceLocked(): Promise<boolean>;
  /** P15 #703: asks for the phone's unlock (PIN, pattern, fingerprint); true once unlocked. */
  requestUnlock(): Promise<boolean>;
}
