/**
 * Faran's Player packages' calls into the `VidoraPlayer` native module (modules/vidorax-media). Every call is safe:
 * without the module (Node tests, an older build) or on a released player it does nothing, so the Player keeps
 * playing with expo-video's defaults.
 */

import type { VideoPlayer } from 'expo-video';

import { getVidoraPlayer, type PlayingVideoSize } from '@modules/vidorax-media';

import { playerLog } from '../diagnostics';

function warn(call: string, error: unknown): void {
  playerLog('player.engine_call_failed', { call, message: error instanceof Error ? error.message : String(error) }, 'warn');
}

/** P14 #670 / P17 #574: the stream quality cap and Audio Only Mode. */
export function applyTrackLimits(player: VideoPlayer, limits: { maxLongSide: number | null; videoDisabled: boolean }): void {
  const native = getVidoraPlayer();
  if (!native) {
    return;
  }
  native.setTrackLimits(player, limits.maxLongSide, limits.videoDisabled).catch((error: unknown) => warn('setTrackLimits', error));
}

/** P14 #670: the playing video track's size (an adaptive stream changes it with the connection). */
export async function readPlayingVideoSize(player: VideoPlayer): Promise<PlayingVideoSize | null> {
  const native = getVidoraPlayer();
  if (!native) {
    return null;
  }
  try {
    return await native.getPlayingVideoSize(player);
  } catch (error) {
    warn('getPlayingVideoSize', error);
    return null;
  }
}

/** P15 #661 / #701: what the media session's ⏭ / ⏮ may do (the Player's queue). */
export function applyQueueNavigation(
  player: VideoPlayer,
  navigation: { enabled: boolean; hasNext: boolean; hasPrevious: boolean },
): void {
  const native = getVidoraPlayer();
  if (!native) {
    return;
  }
  native
    .setQueueNavigation(player, navigation.enabled, navigation.hasNext, navigation.hasPrevious)
    .catch((error: unknown) => warn('setQueueNavigation', error));
}

/** P15 #661 / #701: a media session's ⏭ / ⏮ for the Player's queue. Returns the unsubscribe. */
export function subscribeQueueCommands(listener: (command: 'next' | 'previous') => void): () => void {
  const native = getVidoraPlayer();
  if (!native) {
    return () => undefined;
  }
  const subscription = native.addListener('onQueueCommand', (event) => {
    if (event?.command === 'next' || event?.command === 'previous') {
      listener(event.command);
    }
  });
  return () => subscription.remove();
}

/** P15 #560: pause when headphones are unplugged or a Bluetooth headset disconnects. */
export function applyPauseWhenAudioBecomesNoisy(player: VideoPlayer, enabled: boolean): void {
  const native = getVidoraPlayer();
  if (!native) {
    return;
  }
  native.setPauseWhenAudioBecomesNoisy(player, enabled).catch((error: unknown) => warn('setPauseWhenAudioBecomesNoisy', error));
}

/** P15 #703: show the window over the lock screen (only while the Player is in front). */
export function applyShowWhenLocked(show: boolean): void {
  const native = getVidoraPlayer();
  if (!native) {
    return;
  }
  native.setShowWhenLocked(show).catch((error: unknown) => warn('setShowWhenLocked', error));
}

/** P15 #703: the phone is locked; false when it can't be told. */
export async function readDeviceLocked(): Promise<boolean> {
  const native = getVidoraPlayer();
  if (!native) {
    return false;
  }
  try {
    return await native.isDeviceLocked();
  } catch (error) {
    warn('isDeviceLocked', error);
    return false;
  }
}

/** P15 #703: asks for the phone's unlock; true once it is unlocked. */
export async function requestDeviceUnlock(): Promise<boolean> {
  const native = getVidoraPlayer();
  if (!native) {
    return true;
  }
  try {
    return await native.requestUnlock();
  } catch (error) {
    warn('requestUnlock', error);
    return false;
  }
}

/**
 * P16 #538: voices keep their pitch at any speed. expo-video's Android player leaves it uncorrected unless told (its
 * own property, not a VidoraPlayer call).
 */
export function applyPitchCorrection(player: { preservesPitch: boolean }, on: boolean): void {
  try {
    player.preservesPitch = on;
  } catch {
    // A released player.
  }
}

/** P17 #554: the audio delay (ms), the same in real time at this speed. */
export function applyAudioDelay(player: VideoPlayer, delayMs: number, speed: number): void {
  const native = getVidoraPlayer();
  if (!native) {
    return;
  }
  native
    .setAudioDelay(player, Math.round(delayMs), Number.isFinite(speed) && speed > 0 ? speed : 1)
    .catch((error: unknown) => warn('setAudioDelay', error));
}

/** P17 #553: plays one of the video's audio tracks (expo-video's own property). */
export function selectAudioTrack(player: { audioTrack: unknown }, track: unknown): void {
  try {
    player.audioTrack = track;
  } catch {
    // A released player.
  }
}
