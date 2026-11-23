/**
 * P16 Speed & pitch on the Player screen: pitch correction (#538) and each video's own speed (#736). The speed sheet
 * (#537) and the speed button (#544) are the screen's (`SpeedSheet`, `speedButtonTarget`). Called by
 * `usePlayerEngine`.
 */

import type { VideoPlayer } from 'expo-video';
import { useEffect, useRef } from 'react';

import { DEFAULT_PLAYBACK_RATE } from '../playback-rates';
import { applyPitchCorrection } from './native-player';
import { rememberedSpeedFor, saveSpeedFor, useSpeedSettings } from './speed-settings';

export function useSpeedEngine(input: {
  player: VideoPlayer;
  mediaId: string | null;
  isReady: boolean;
  playbackRate: number;
  setPlaybackRate: (rate: number) => boolean;
}): void {
  const { player, mediaId, isReady, playbackRate, setPlaybackRate } = input;
  const settings = useSpeedSettings();

  // #538: expo-video's Android player leaves the pitch uncorrected unless told; voices stay natural with it on.
  useEffect(() => {
    if (!isReady) {
      return;
    }
    applyPitchCorrection(player, settings.pitchCorrection);
  }, [isReady, player, settings.pitchCorrection]);

  // #736: every video starts at its own speed (or 1.0×) — the native player keeps the previous video's rate
  // otherwise — and a speed chosen while it plays is kept for it.
  const restoredFor = useRef<string | null>(null);
  // The speed being restored: until the session shows it, its value is the load's reset 1.0×, not the user's choice.
  const restoring = useRef<number | null>(null);
  useEffect(() => {
    if (!isReady || !mediaId || restoredFor.current === mediaId) {
      return;
    }
    restoredFor.current = mediaId;
    const target = (settings.rememberPerVideo ? rememberedSpeedFor(mediaId) : null) ?? DEFAULT_PLAYBACK_RATE;
    // Wait for the session to show the restored speed only when it changes it: an unchanged speed re-renders
    // nothing, so the wait would never end and the next speed the user picks would not be kept (found on the device).
    const changes = Math.abs(target - playbackRate) > 1e-6;
    restoring.current = setPlaybackRate(target) && changes ? target : null;
    // Only when the video changes: later speed changes are the user's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, mediaId]);

  useEffect(() => {
    if (!mediaId || restoredFor.current !== mediaId) {
      return;
    }
    if (restoring.current != null) {
      if (Math.abs(playbackRate - restoring.current) < 1e-6) {
        restoring.current = null;
      }
      return;
    }
    if (settings.rememberPerVideo) {
      saveSpeedFor(mediaId, playbackRate);
    }
  }, [mediaId, playbackRate, settings.rememberPerVideo]);
}
