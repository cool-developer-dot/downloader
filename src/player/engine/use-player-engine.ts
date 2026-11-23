/**
 * Faran's Player packages (P14–P19) on the Player screen: one hook keeps the native player in step with their
 * settings and gives the options sheet its `engine` part and the screen its sheets' state. The screen calls it once;
 * each package's part is its own hook (`use-stream-engine`, `use-headset-keys`, …).
 */

import type { VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useMemo } from 'react';

import { useTranslation } from '@/localization';

import type { AdjustmentHud } from '../adjustment-hud';
import type { PlayerVolumeState } from '../hooks/use-player-volume';
import { audioTrackLabel, formatAudioDelay } from './audio-settings';
import { closeEngineSheet, openEngineSheet, useOpenEngineSheet } from './engine-sheets';
import { applyTrackLimits } from './native-player';
import type { PlayerEngineOption } from './types';
import { useAudioEngine, type AudioEngine } from './use-audio-engine';
import { useHeadsetKeys, type HeadsetKeys, type PlayerKeyHandlers } from './use-headset-keys';
import { useSpeedEngine } from './use-speed-engine';
import { useStreamEngine, type StreamQualitySheetState } from './use-stream-engine';

export { streamCapLabel } from './use-stream-engine';

export type UsePlayerEngineInput = {
  player: VideoPlayer;
  mediaId: string | null;
  isReady: boolean;
  isPlaying: boolean;
  positionSeconds: number;
  seekStepSeconds: number;
  isFullscreen: boolean;
  pipActive: boolean;
  /** A sheet is open or the screen is locked: keys keep their normal job. */
  inputBlocked: boolean;
  handlers: PlayerKeyHandlers;
  volume: PlayerVolumeState;
  hud: AdjustmentHud;
  volumeFallback: { level: number; set: (level: number) => void };
  /** Leaves the Player for the Downloads tab (the video carries on in the mini player). */
  leaveToDownloads: () => void;
  /** P16: the session's speed, and how to set it (the session's own, so the chip and the notification follow). */
  playbackRate: number;
  setPlaybackRate: (rate: number) => boolean;
};

export type PlayerEngineSheets = {
  streamQuality: StreamQualitySheetState;
  headsetKeys: { visible: boolean; close: () => void };
  audio: { visible: boolean; close: () => void; engine: AudioEngine };
};

export type PlayerEngine = {
  option: PlayerEngineOption;
  sheets: PlayerEngineSheets;
  keys: HeadsetKeys;
  /** P17 #574: no picture is decoded; the screen shows the audio-only cover. */
  audioOnly: boolean;
};

export function usePlayerEngine(input: UsePlayerEngineInput): PlayerEngine {
  const { t } = useTranslation();
  const { player, isReady } = input;

  // P14
  const stream = useStreamEngine({
    t,
    player,
    mediaId: input.mediaId,
    isReady,
    isPlaying: input.isPlaying,
    leaveToDownloads: input.leaveToDownloads,
  });

  // P17
  const audio = useAudioEngine({ player, mediaId: input.mediaId, isReady, playbackRate: input.playbackRate });

  // The track limits: P14's stream quality cap and P17's Audio Only Mode.
  const { maxLongSide } = stream;
  const videoDisabled = audio.audioOnly;
  useEffect(() => {
    if (isReady) {
      applyTrackLimits(player, { maxLongSide, videoDisabled });
    }
  }, [isReady, maxLongSide, player, videoDisabled]);

  // P15
  const keys = useHeadsetKeys({
    player,
    isReady,
    positionSeconds: input.positionSeconds,
    seekStepSeconds: input.seekStepSeconds,
    isFullscreen: input.isFullscreen,
    pipActive: input.pipActive,
    inputBlocked: input.inputBlocked,
    handlers: input.handlers,
    volume: input.volume,
    hud: input.hud,
    volumeFallback: input.volumeFallback,
  });
  // P16
  useSpeedEngine({
    player,
    mediaId: input.mediaId,
    isReady,
    playbackRate: input.playbackRate,
    setPlaybackRate: input.setPlaybackRate,
  });

  const openSheet = useOpenEngineSheet();
  const openHeadsetKeys = useCallback(() => openEngineSheet('headsetKeys'), []);
  const openAudio = useCallback(() => openEngineSheet('audio'), []);

  const trackIndex = audio.track ? audio.tracks.findIndex((track) => track === audio.track) : -1;
  const trackLabel =
    audio.track && audio.tracks.length > 1
      ? audioTrackLabel(audio.track, Math.max(0, trackIndex), (n) => t('playerEngine.audioTrackNumber', { n }))
      : null;
  const audioOption = useMemo(
    () => ({
      trackLabel,
      delayLabel: formatAudioDelay(audio.delayMs),
      audioOnly: audio.audioOnly,
      setAudioOnly: audio.setAudioOnly,
      open: openAudio,
    }),
    [audio.audioOnly, audio.delayMs, audio.setAudioOnly, openAudio, trackLabel],
  );

  const option = useMemo<PlayerEngineOption>(
    () => ({ stream: stream.option, headsetKeys: { open: openHeadsetKeys }, audio: audioOption }),
    [audioOption, openHeadsetKeys, stream.option],
  );

  const sheets = useMemo<PlayerEngineSheets>(
    () => ({
      streamQuality: stream.sheet,
      headsetKeys: { visible: openSheet === 'headsetKeys', close: closeEngineSheet },
      audio: { visible: openSheet === 'audio', close: closeEngineSheet, engine: audio },
    }),
    [audio, openSheet, stream.sheet],
  );

  return { option, sheets, keys, audioOnly: audio.audioOnly };
}
