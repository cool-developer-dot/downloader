/**
 * Faran's Player packages (P14–P19) on the Player screen: one hook keeps the native player in step with their
 * settings and gives the options sheet its `engine` part and the screen its sheets' state. The screen calls it once;
 * each package's part is its own hook (`use-stream-engine`, `use-headset-keys`, …).
 */

import type { VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useTranslation } from '@/localization';

import type { AdjustmentHud } from '../adjustment-hud';
import type { PlayerVolumeState } from '../hooks/use-player-volume';
import { applyTrackLimits } from './native-player';
import type { PlayerEngineOption } from './types';
import { useHeadsetKeys, type HeadsetKeys, type PlayerKeyHandlers } from './use-headset-keys';
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
};

export type PlayerEngineSheets = {
  streamQuality: StreamQualitySheetState;
  headsetKeys: { visible: boolean; close: () => void };
};

export type PlayerEngine = {
  option: PlayerEngineOption;
  sheets: PlayerEngineSheets;
  keys: HeadsetKeys;
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

  // The track limits: P14's stream quality cap.
  const { maxLongSide } = stream;
  useEffect(() => {
    if (isReady) {
      applyTrackLimits(player, { maxLongSide, videoDisabled: false });
    }
  }, [isReady, maxLongSide, player]);

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
  const [headsetKeysOpen, setHeadsetKeysOpen] = useState(false);
  const openHeadsetKeys = useCallback(() => setHeadsetKeysOpen(true), []);
  const closeHeadsetKeys = useCallback(() => setHeadsetKeysOpen(false), []);

  const option = useMemo<PlayerEngineOption>(
    () => ({ stream: stream.option, headsetKeys: { open: openHeadsetKeys } }),
    [openHeadsetKeys, stream.option],
  );

  const sheets = useMemo<PlayerEngineSheets>(
    () => ({
      streamQuality: stream.sheet,
      headsetKeys: { visible: headsetKeysOpen, close: closeHeadsetKeys },
    }),
    [closeHeadsetKeys, headsetKeysOpen, stream.sheet],
  );

  return { option, sheets, keys };
}
