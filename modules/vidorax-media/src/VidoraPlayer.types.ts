import type { VideoPlayer } from 'expo-video';

/**
 * The `VidoraPlayer` native module (VidoraPlayerModule.kt): Faran's Player packages P14–P19 reach expo-video's
 * ExoPlayer through it — the settings expo-video's own JavaScript API has no property for. Every call takes the
 * expo-video player it acts on and runs on Android's main thread. Calls on a released player do nothing.
 */

/** P14 #670: the size of the video track playing now (an adaptive stream changes it with the connection). */
export type PlayingVideoSize = { width: number; height: number; bitrate: number };

export type VidoraPlayerEvents = Record<string, never>;

export interface VidoraPlayerModuleApi {
  /**
   * P14 #670 / P17 #574: the longest video side the player may pick (null = any; HLS / DASH adapt below it) and
   * whether video is decoded at all (false = Audio Only Mode).
   */
  setTrackLimits(player: VideoPlayer, maxLongSide: number | null, videoDisabled: boolean): Promise<void>;
  /** P14 #670: the playing video track's size; null before one is known. */
  getPlayingVideoSize(player: VideoPlayer): Promise<PlayingVideoSize | null>;
}
