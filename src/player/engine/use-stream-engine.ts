/**
 * P14 Streams in the player on the Player screen: the stream quality cap (#670) and its "Auto · 720p now" label, and
 * Download this stream (#672). Called by `usePlayerEngine`, which applies the cap with the other track limits.
 */

import type { VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { TranslateFn } from '@/localization';

import { isStreamMediaId, knownRemoteStream } from '../remote-stream';
import { readPlayingVideoSize } from './native-player';
import { requestStreamDownload } from './stream-download-handoff';
import {
  playingQualityLabel,
  setStreamQuality,
  streamQualityLongSide,
  useStreamQuality,
  type StreamQuality,
} from './stream-quality';
import type { PlayerEngineStreamOption } from './types';

/** How often the playing quality of an adaptive stream is read again while it plays. */
const STREAM_QUALITY_POLL_MS = 4_000;

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

export type StreamQualitySheetState = {
  visible: boolean;
  selected: StreamQuality;
  select: (quality: StreamQuality) => void;
  close: () => void;
};

export type StreamEngine = {
  /** The longest side the player may pick now (null = no cap: not a stream, or Auto). */
  maxLongSide: number | null;
  option: PlayerEngineStreamOption | null;
  sheet: StreamQualitySheetState;
};

export function useStreamEngine(input: {
  t: TranslateFn;
  player: VideoPlayer;
  mediaId: string | null;
  isReady: boolean;
  isPlaying: boolean;
  leaveToDownloads: () => void;
}): StreamEngine {
  const { t, player, mediaId, isReady, isPlaying, leaveToDownloads } = input;
  const isStream = isStreamMediaId(mediaId);
  const streamQuality = useStreamQuality();

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

  const [sheetOpen, setSheetOpen] = useState(false);
  const openQuality = useCallback(() => setSheetOpen(true), []);
  const close = useCallback(() => setSheetOpen(false), []);
  const select = useCallback((quality: StreamQuality) => {
    setStreamQuality(quality);
    setSheetOpen(false);
  }, []);

  const download = useCallback(() => {
    const stream = knownRemoteStream(mediaId);
    if (!stream) {
      return;
    }
    requestStreamDownload({ url: stream.uri, referer: stream.headers.Referer ?? null });
    leaveToDownloads();
  }, [leaveToDownloads, mediaId]);

  const now = playingQualityLabel(playingSize);
  const cap = streamCapLabel(t, streamQuality);
  const option = useMemo(
    () =>
      isStream
        ? { qualityLabel: now ? t('playerEngine.streamQualityNow', { cap, quality: now }) : cap, openQuality, download }
        : null,
    [cap, download, isStream, now, openQuality, t],
  );
  const sheet = useMemo(
    () => ({ visible: sheetOpen, selected: streamQuality, select, close }),
    [close, select, sheetOpen, streamQuality],
  );

  return { maxLongSide: isStream ? streamQualityLongSide(streamQuality) : null, option, sheet };
}
