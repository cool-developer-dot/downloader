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
