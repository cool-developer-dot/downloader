import type { VideoPlayer } from 'expo-video';
import { useEffect } from 'react';

/** After the view is mounted natively (Fabric mounts after the JS commit), so the frame lands in the new surface. */
const ATTACH_SETTLE_MS = 150;

/**
 * A view that takes over the session's picture (the mini player, or the full Player reopened from it) shows nothing
 * while the player is paused or finished: the decoder only draws into a new surface when it renders a frame. Seeking
 * in place makes it draw the current frame (just before the end for a finished video, which has none left to draw).
 * Playing players need nothing — their next frame arrives anyway.
 */
export function redrawPausedFrame(player: VideoPlayer): void {
  try {
    // A finished video reports `idle` (expo-video maps Media3's ENDED to it); loading/error have nothing to draw.
    if (player.playing || (player.status !== 'readyToPlay' && player.status !== 'idle')) {
      return;
    }
    const position = player.currentTime;
    const duration = player.duration;
    if (!Number.isFinite(position) || !(duration > 0)) {
      return;
    }
    const ended = position >= duration - 0.05;
    if (ended) {
      // Media3 ends with playWhenReady still on: without this the seek would play the last moment (and its sound) again.
      player.pause();
    }
    player.currentTime = ended ? Math.max(0, duration - 0.1) : position;
  } catch {
    // A released player (the session just closed) has nothing to draw.
  }
}

/**
 * Redraws the paused frame once this view has attached to `player` (see redrawPausedFrame), and again whenever
 * `redrawKey` changes (e.g. the video finished: the decoder lets the surface go at the end).
 */
export function useRedrawOnAttach(player: VideoPlayer, enabled: boolean, redrawKey: unknown = null): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const timer = setTimeout(() => redrawPausedFrame(player), ATTACH_SETTLE_MS);
    return () => clearTimeout(timer);
    // Once per attach (the view's player never changes: views are keyed by session) and per redrawKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, redrawKey]);
}
