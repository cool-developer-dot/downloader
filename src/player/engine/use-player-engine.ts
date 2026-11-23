/**
 * Faran's Player packages (P14–P19) on the Player screen: one hook keeps the native player in step with their
 * settings and gives the options sheet its `engine` part and the screen its sheets' state. The screen calls it once.
 */

import type { VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useTranslation, type TranslateFn } from '@/localization';

import { isStreamMediaId, knownRemoteStream } from '../remote-stream';
import { applyTrackLimits, readPlayingVideoSize } from './native-player';
import { requestStreamDownload } from './stream-download-handoff';
import {
  playingQualityLabel,
  setStreamQuality,
  streamQualityLongSide,
  useStreamQuality,
  type StreamQuality,
} from './stream-quality';
import type { PlayerEngineOption } from './types';

/** How often the playing quality of an adaptive stream is read again while it plays. */
const STREAM_QUALITY_POLL_MS = 4_000;

export type UsePlayerEngineInput = {
  player: VideoPlayer;
  mediaId: string | null;
  isReady: boolean;
  isPlaying: boolean;
  /** Leaves the Player for the Downloads tab (the video carries on in the mini player). */
  leaveToDownloads: () => void;
};

export type PlayerEngineSheets = {
  streamQuality: { visible: boolean; selected: StreamQuality; select: (quality: StreamQuality) => void; close: () => void };
};

export type PlayerEngine = {
  option: PlayerEngineOption;
  sheets: PlayerEngineSheets;
};

export function streamCapLabel(t: TranslateFn, quality: StreamQuality): string {
  switch (quality) {
    case 'saver':
      return t('playerEngine.streamQualitySaver');
    case '720':
      return t('playerEngine.streamQuality720');
    case '1080':
      return t('playerEngine.streamQuality1080');
    default:
      return t('playerEngine.streamQualityAuto');
  }
}

export function usePlayerEngine({ player, mediaId, isReady, isPlaying, leaveToDownloads }: UsePlayerEngineInput): PlayerEngine {
  const { t } = useTranslation();
  const isStream = isStreamMediaId(mediaId);

  // --- P14 #670 Adaptive bitrate: the cap applies to online streams only (a file has one quality). ---------------
  const streamQuality = useStreamQuality();
  const maxLongSide = isStream ? streamQualityLongSide(streamQuality) : null;
  useEffect(() => {
    if (!isReady) {
      return;
    }
    applyTrackLimits(player, { maxLongSide, videoDisabled: false });
  }, [isReady, maxLongSide, player]);

  // Kept with the video it was read for, so another video never shows the previous stream's quality.
  const [playing, setPlaying] = useState<{ mediaId: string | null; size: { width: number; height: number } | null }>({
    mediaId: null,
    size: null,
  });
  const playingSize = playing.mediaId === mediaId ? playing.size : null;
  useEffect(() => {
    if (!isStream || !isReady) {
      return;
    }
    let cancelled = false;
    const read = () => {
      void readPlayingVideoSize(player).then((size) => {
        if (!cancelled) {
          setPlaying((previous) =>
            previous.mediaId === mediaId && previous.size?.width === size?.width && previous.size?.height === size?.height
              ? previous
              : { mediaId, size },
          );
        }
      });
    };
    read();
    const timer = isPlaying ? setInterval(read, STREAM_QUALITY_POLL_MS) : null;
    return () => {
      cancelled = true;
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [isPlaying, isReady, isStream, mediaId, player, streamQuality]);

  const [streamQualityOpen, setStreamQualityOpen] = useState(false);
  const openStreamQuality = useCallback(() => setStreamQualityOpen(true), []);
  const closeStreamQuality = useCallback(() => setStreamQualityOpen(false), []);
  const selectStreamQuality = useCallback((quality: StreamQuality) => {
    setStreamQuality(quality);
    setStreamQualityOpen(false);
  }, []);

  // --- P14 #672 Download integration ---------------------------------------------------------------------------
  const downloadStream = useCallback(() => {
    const stream = knownRemoteStream(mediaId);
    if (!stream) {
      return;
    }
    requestStreamDownload({ url: stream.uri, referer: stream.headers.Referer ?? null });
    leaveToDownloads();
  }, [leaveToDownloads, mediaId]);

  const now = playingQualityLabel(playingSize);
  const cap = streamCapLabel(t, streamQuality);
  const streamOption = useMemo(
    () =>
      isStream
        ? {
            qualityLabel: now ? t('playerEngine.streamQualityNow', { cap, quality: now }) : cap,
            openQuality: openStreamQuality,
            download: downloadStream,
          }
        : null,
    [cap, downloadStream, isStream, now, openStreamQuality, t],
  );

  const option = useMemo<PlayerEngineOption>(() => ({ stream: streamOption }), [streamOption]);

  const sheets = useMemo<PlayerEngineSheets>(
    () => ({
      streamQuality: {
        visible: streamQualityOpen,
        selected: streamQuality,
        select: selectStreamQuality,
        close: closeStreamQuality,
      },
    }),
    [closeStreamQuality, selectStreamQuality, streamQuality, streamQualityOpen],
  );

  return { option, sheets };
}
