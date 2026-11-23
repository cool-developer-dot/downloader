/**
 * P17 Audio tracks & delay on the Player screen: the video's audio tracks (#553), the audio delay (#554) and Audio Only
 * Mode (#574; `usePlayerEngine` turns its video decoding off with the other track limits). Called by
 * `usePlayerEngine`.
 */

import { useEventListener } from 'expo';
import type { AudioTrack, VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  isSameAudioTrack,
  normalizeAudioDelay,
  playingAudioTrack,
  rememberedDelayFor,
  saveDelayFor,
  setAudioOnly,
  useAudioOnly,
} from './audio-settings';
import { applyAudioDelay, selectAudioTrack } from './native-player';

export type AudioEngine = {
  tracks: readonly AudioTrack[];
  /** The playing track; null when the video has no sound or none is known yet. */
  track: AudioTrack | null;
  selectTrack: (track: AudioTrack) => void;
  delayMs: number;
  setDelayMs: (delayMs: number) => void;
  audioOnly: boolean;
  setAudioOnly: (on: boolean) => void;
};

function readTracks(player: VideoPlayer): { tracks: AudioTrack[]; track: AudioTrack | null } {
  try {
    return { tracks: [...(player.availableAudioTracks ?? [])], track: player.audioTrack ?? null };
  } catch {
    return { tracks: [], track: null };
  }
}

export function useAudioEngine(input: {
  player: VideoPlayer;
  mediaId: string | null;
  isReady: boolean;
  playbackRate: number;
}): AudioEngine {
  const { player, mediaId, isReady, playbackRate } = input;

  // --- #553 ------------------------------------------------------------------------------------------------------
  // Read once (the Player reopened over a video already loaded), then on each load and each change.
  const [trackState, setTrackState] = useState<{ tracks: AudioTrack[]; track: AudioTrack | null }>(() =>
    readTracks(player),
  );
  const refreshTracks = useCallback(() => setTrackState(readTracks(player)), [player]);
  useEventListener(player, 'sourceLoad', refreshTracks);
  useEventListener(player, 'availableAudioTracksChange', refreshTracks);
  useEventListener(player, 'audioTrackChange', refreshTracks);

  const selectTrack = useCallback(
    (track: AudioTrack) => {
      if (isSameAudioTrack(track, trackState.track)) {
        return;
      }
      selectAudioTrack(player, track);
      setTrackState((previous) => ({ ...previous, track }));
    },
    [player, trackState.track],
  );

  // --- #554: each video's own delay, applied again when the speed changes (it is kept in real time) ---------------
  const [delay, setDelay] = useState<{ mediaId: string | null; ms: number }>({ mediaId: null, ms: 0 });
  const delayMs = delay.mediaId === mediaId ? delay.ms : rememberedDelayFor(mediaId);
  useEffect(() => {
    if (isReady) {
      applyAudioDelay(player, delayMs, playbackRate);
    }
  }, [delayMs, isReady, mediaId, playbackRate, player]);

  const setDelayMs = useCallback(
    (ms: number) => {
      const next = normalizeAudioDelay(ms);
      setDelay({ mediaId, ms: next });
      saveDelayFor(mediaId, next);
    },
    [mediaId],
  );

  // --- #574 ------------------------------------------------------------------------------------------------------
  const audioOnly = useAudioOnly();

  return useMemo(
    () => ({
      tracks: trackState.tracks,
      track: playingAudioTrack(trackState.tracks, trackState.track),
      selectTrack,
      delayMs,
      setDelayMs,
      audioOnly,
      setAudioOnly,
    }),
    [audioOnly, delayMs, selectTrack, setDelayMs, trackState.track, trackState.tracks],
  );
}
