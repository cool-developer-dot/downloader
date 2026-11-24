/**
 * P13 #667 Chromecast on the Player screen: the Cast button, the device sheet, "Casting to <device>", and the phone's
 * controls driving the TV.
 *
 * - **Starting:** the user picks a device. Before anything connects, the video is checked (`cast-rules.ts`: never a
 *   Private Folder video; a stream only when the TV can open it). Once connected, the phone's player pauses through
 *   its own controller and the TV starts where the phone was (`cast-handover.ts`), with the chosen subtitle file as
 *   WebVTT (`webvtt.ts`; none when no file is showing).
 * - **While casting:** play / pause, the timeline, ⏪ / ⏩ and exact seeks go to the TV (the Player screen routes them
 *   here); the phone's player stays paused. Previous / Next keep casting: the next video is loaded on the TV.
 * - **Stopping:** the phone continues from the TV's position — playing when the user stopped the cast, paused when the
 *   connection dropped.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { CastDevice, CastErrorCode, CastMediaState } from '@modules/vidorax-media/src/VidoraCast.types';

import { useTranslation, type TranslationKey } from '@/localization';
import { castStartPositionMs, phoneResumeAfterCast } from '@/player/cast/cast-handover';
import { castBlockReason, type CastBlockReason } from '@/player/cast/cast-rules';
import { isCastingMedia, useCastStore, type CastConnection } from '@/player/cast/cast-store';
import {
  castPause,
  castPlay,
  castSeek,
  castSetVolume,
  connectCastDevice,
  loadOnCast,
  stopCasting,
} from '@/player/cast/cast.runtime';
import { cuesToWebVtt, webVttHasCues } from '@/player/cast/webvtt';
import { resolvePlaybackSource } from '@/player/resolve-playback-source';
import type { SubtitleCue } from '@/player/subtitles/cues';
import type { SubtitleFileRef } from '@/player/subtitles/subtitle-record';
import type { PlaybackSource } from '@/player/types';

import { announcePlayer } from './use-player-not-yet';

type CastController = { play: () => void; pause: () => void };

export type PlayerCastInput = {
  mediaId: string | null;
  isReady: boolean;
  isPlaying: boolean;
  isCompleted: boolean;
  positionSeconds: number;
  durationSeconds: number | null;
  controller: CastController;
  /** The session's own exact seek (the timeline's path), for continuing on the phone. */
  beginSeekPreview: (seconds: number) => void;
  commitSeekPreview: () => void;
  /** The subtitle file showing (null: off, or a track inside the video, which the TV can't get). */
  subtitleFile: SubtitleFileRef | null;
  subtitleCues: readonly SubtitleCue[] | null;
  subtitleOffsetMs: number;
};

export type PlayerCast = {
  /** The Cast button, shown only once a device is found (or while casting). */
  button: { active: boolean; onPress: () => void } | null;
  /** The TV plays this video now: the phone's controls drive it. */
  casting: boolean;
  connecting: boolean;
  deviceName: string | null;
  mediaState: CastMediaState;
  /** For the device sheet. */
  devices: readonly CastDevice[];
  connection: CastConnection;
  /** The TV's volume, 0–1, when it has reported one. */
  volume: number | null;
  isPlaying: boolean;
  positionSeconds: number;
  durationSeconds: number | null;
  sheetOpen: boolean;
  closeSheet: () => void;
  pickDevice: (deviceId: string) => void;
  stop: () => void;
  changeVolume: (delta: number) => void;
  togglePlay: () => void;
  seekBy: (deltaSeconds: number) => void;
  /** An exact seek on the phone also moves the TV while casting. */
  seekIfCasting: (seconds: number) => void;
};

/** The video the user picked a device for: loaded on the TV as soon as the session is up. */
let pendingCastMediaId: string | null = null;

/** The TV volume step of the sheet's − / + buttons. */
export const CAST_VOLUME_STEP = 0.1;

function contentTypeOf(source: PlaybackSource): string | null {
  if (source.contentType === 'hls') {
    return 'application/x-mpegURL';
  }
  if (source.contentType === 'dash') {
    return 'application/dash+xml';
  }
  return source.mimeType;
}

export function usePlayerCast(input: PlayerCastInput): PlayerCast {
  const { t } = useTranslation();
  const devices = useCastStore((s) => s.devices);
  const connection = useCastStore((s) => s.connection);
  const deviceName = useCastStore((s) => s.deviceName);
  const media = useCastStore((s) => s.media);
  const positionMs = useCastStore((s) => s.positionMs);
  const durationMs = useCastStore((s) => s.durationMs);
  const volume = useCastStore((s) => s.volume);
  const castMediaId = useCastStore((s) => s.castMediaId);
  const lastDisconnect = useCastStore((s) => s.lastDisconnect);
  const lastError = useCastStore((s) => s.lastError);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { mediaId, isReady, isPlaying, controller, beginSeekPreview, commitSeekPreview } = input;
  const casting = isCastingMedia({ connection, castMediaId }, mediaId);

  // The latest inputs, for the asynchronous load (it must use the position at the moment it runs).
  const latest = useRef(input);
  useLayoutEffect(() => {
    latest.current = input;
  });

  const blockMessage = useCallback(
    (reason: CastBlockReason) =>
      t(
        reason === 'private'
          ? 'playerCast.blockedPrivate'
          : reason === 'still_downloading'
            ? 'playerCast.blockedDownloading'
            : reason === 'stream_unsupported'
              ? 'playerCast.blockedStream'
              : 'playerCast.blockedOther',
      ),
    [t],
  );

  /** The video as the TV would get it, or null (with the reason said) when it can't be cast. */
  const castableSource = useCallback(
    async (id: string): Promise<PlaybackSource | null> => {
      let source: PlaybackSource;
      try {
        source = await resolvePlaybackSource(id);
      } catch {
        announcePlayer(t('playerCast.fileUnavailable'));
        return null;
      }
      const block = castBlockReason({ mediaId: id, uri: source.uri, headers: source.headers });
      if (block) {
        announcePlayer(blockMessage(block));
        return null;
      }
      return source;
    },
    [blockMessage, t],
  );

  // Connected (or casting moved to this video with Previous / Next): load this video on the TV.
  const loadingFor = useRef<string | null>(null);
  useEffect(() => {
    if (connection !== 'connected' || !isReady || !mediaId || castMediaId === mediaId) {
      return;
    }
    const followsPlayer = castMediaId != null || pendingCastMediaId === mediaId;
    if (!followsPlayer || loadingFor.current === mediaId) {
      return;
    }
    loadingFor.current = mediaId;
    void (async () => {
      const source = await castableSource(mediaId);
      if (!source) {
        // This one can't go to the TV: casting ends, and the phone plays it.
        pendingCastMediaId = null;
        stopCasting();
        return;
      }
      const now = latest.current;
      controller.pause();
      const startMs = castStartPositionMs({
        positionSeconds: now.positionSeconds,
        durationSeconds: now.durationSeconds,
        isCompleted: now.isCompleted,
      });
      const vtt = now.subtitleFile && now.subtitleCues ? cuesToWebVtt(now.subtitleCues, now.subtitleOffsetMs) : null;
      loadOnCast(mediaId, {
        uri: source.uri,
        contentType: contentTypeOf(source),
        title: source.displayName,
        positionMs: startMs,
        autoplay: true,
        subtitleVtt: vtt && webVttHasCues(vtt) ? vtt : null,
        subtitleLanguage: now.subtitleFile?.language ?? null,
        subtitleLabel: now.subtitleFile?.name ?? null,
      });
      pendingCastMediaId = null;
    })().finally(() => {
      if (loadingFor.current === mediaId) {
        loadingFor.current = null;
      }
    });
  }, [castMediaId, castableSource, connection, controller, isReady, mediaId]);

  // While the TV plays this video, the phone's player stays paused (autoplay of the next video, a stray play).
  useEffect(() => {
    if (casting && isPlaying) {
      controller.pause();
    }
  }, [casting, controller, isPlaying]);

  // Casting ended: the phone continues from the TV's position. Only ends that happen while this view is up.
  const seenDisconnect = useRef(lastDisconnect?.seq ?? 0);
  useEffect(() => {
    if (!lastDisconnect || lastDisconnect.seq <= seenDisconnect.current) {
      return;
    }
    seenDisconnect.current = lastDisconnect.seq;
    if (lastDisconnect.mediaId == null || lastDisconnect.mediaId !== mediaId) {
      if (lastDisconnect.reason === 'failed') {
        announcePlayer(t('playerCast.connectFailed'));
      }
      return;
    }
    const resume = phoneResumeAfterCast({
      reason: lastDisconnect.reason,
      tvPositionMs: lastDisconnect.positionMs,
      finished: lastDisconnect.finished,
      durationSeconds: latest.current.durationSeconds,
      wasCasting: true,
    });
    if (resume.seekSeconds != null) {
      beginSeekPreview(resume.seekSeconds);
      commitSeekPreview();
    }
    if (resume.play) {
      controller.play();
    }
    announcePlayer(t(lastDisconnect.reason === 'stopped' ? 'playerCast.stopped' : 'playerCast.dropped'));
  }, [beginSeekPreview, commitSeekPreview, controller, lastDisconnect, mediaId, t]);

  // Errors from the TV or the phone's server, said once each.
  const seenError = useRef(lastError?.seq ?? 0);
  useEffect(() => {
    if (!lastError || lastError.seq <= seenError.current) {
      return;
    }
    seenError.current = lastError.seq;
    const key: Partial<Record<CastErrorCode, TranslationKey>> = {
      unavailable: 'playerCast.unavailable',
      device_gone: 'playerCast.deviceGone',
      connect_failed: 'playerCast.connectFailed',
      no_wifi: 'playerCast.noWifi',
      private: 'playerCast.blockedPrivate',
      still_downloading: 'playerCast.blockedDownloading',
      stream_unsupported: 'playerCast.blockedStream',
      file_unavailable: 'playerCast.fileUnavailable',
      server_failed: 'playerCast.fileUnavailable',
      load_failed: 'playerCast.loadFailed',
      playback_failed: 'playerCast.loadFailed',
      volume_failed: 'playerCast.volumeFailed',
    };
    const message = key[lastError.code];
    if (message) {
      announcePlayer(t(message));
    }
    // A video the TV refused: end the cast so the phone takes over.
    if (lastError.code !== 'volume_failed' && lastError.code !== 'connect_failed' && lastError.code !== 'device_gone') {
      if (useCastStore.getState().connection === 'connected') {
        stopCasting();
      }
    }
  }, [lastError, t]);

  const pickDevice = useCallback(
    (deviceId: string) => {
      setSheetOpen(false);
      const id = latest.current.mediaId;
      if (!id) {
        return;
      }
      void (async () => {
        // Checked before connecting: a Private Folder video never reaches the TV, not even its title.
        const source = await castableSource(id);
        if (!source) {
          return;
        }
        pendingCastMediaId = id;
        connectCastDevice(deviceId);
      })();
    },
    [castableSource],
  );

  const stop = useCallback(() => {
    setSheetOpen(false);
    stopCasting();
  }, []);

  const changeVolume = useCallback(
    (delta: number) => {
      castSetVolume(Math.round(((volume ?? 0.5) + delta) * 10) / 10);
    },
    [volume],
  );

  const togglePlay = useCallback(() => {
    if (media === 'playing' || media === 'buffering') {
      castPause();
    } else {
      castPlay();
    }
  }, [media]);

  const castPositionSeconds = (positionMs ?? 0) / 1000;
  const seekBy = useCallback(
    (deltaSeconds: number) => {
      const max = durationMs != null && durationMs > 0 ? durationMs / 1000 : Number.POSITIVE_INFINITY;
      castSeek(Math.min(max, Math.max(0, castPositionSeconds + deltaSeconds)) * 1000);
    },
    [castPositionSeconds, durationMs],
  );

  const seekIfCasting = useCallback(
    (seconds: number) => {
      if (casting && Number.isFinite(seconds)) {
        castSeek(Math.max(0, seconds) * 1000);
      }
    },
    [casting],
  );

  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const visible = devices.length > 0 || connection !== 'idle';

  return {
    button: visible ? { active: connection === 'connected', onPress: openSheet } : null,
    casting,
    connecting: connection === 'connecting' || (connection === 'connected' && !casting && pendingCastMediaId === mediaId),
    deviceName,
    mediaState: media,
    devices,
    connection,
    volume,
    isPlaying: media === 'playing' || media === 'buffering',
    positionSeconds: castPositionSeconds,
    durationSeconds: durationMs != null && durationMs > 0 ? durationMs / 1000 : input.durationSeconds,
    sheetOpen,
    closeSheet,
    pickDevice,
    stop,
    changeVolume,
    togglePlay,
    seekBy,
    seekIfCasting,
  };
}
