/**
 * P10 Screenshot & edit tools (#675, #677–#680): what the Player's ⋮ → Tools rows do, and the sheets they open.
 *
 * - Screenshot: expo-video's frame at the moment playing, at full size (`generateThumbnailsAsync` without a max size),
 *   saved as a JPEG in Pictures/VidoraX (the native side of Save cover image), then offered to the share sheet.
 * - Trim video: the Downloader's Trim screen, starting at the moment playing.
 * - Extract audio, Video converter, Compress video: one edit at a time through the shared edit job, with its progress
 *   and Cancel in a sheet. The video is paused when it starts and kept paused while it runs.
 *
 * The editors only take library items, so their rows are hidden for videos on this device, files from other apps and
 * streams (src/player/edit-tools.ts).
 */

import type { VideoPlayer, VideoThumbnail } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { hasAppDialogHost, showAppDialog } from '@/components/modals/app-dialog';
import { getV2Engine } from '@/downloads/v2/engine-port';
import { ensureGalleryPermission } from '@/downloads/v2/gallery-permission';
import { thumbnailSaveFailure } from '@/downloads/v2/thumbnail-save';
import { useTranslation, type TranslationKey } from '@/localization';
import { isEditRunning } from '@/media-edit/edit-job';
import { getEditJob, useEditJobStore } from '@/media-edit/edit-job-store';
import { editAvailability, isAudioOnlySource, type EditKind } from '@/media-edit/edit-plan';
import { getEditPort } from '@/media-edit/edit-port';
import type { CompressPreset } from '@/media-edit/compress-plan';
import { playerEditMessageKey, runPlayerEdit, type PlayerEditInput } from '@/media-edit/player-edit-run';
import {
  clearPlayerEditOrigin,
  getFramePort,
  nativeEditKinds,
  setPlayerEditOrigin,
  usePlayerEditOrigin,
} from '@/media-edit/player-tools-port';
import { navigation } from '@/navigation';
import { isDeviceMediaId } from '@/player/device-media';
import {
  canEditInPlayer,
  canScreenshot,
  playerToolSource,
  screenshotTitle,
  shouldHoldPause,
  trimRangeFromPosition,
} from '@/player/edit-tools';
import type { PlayerOptionContext } from '@/player/options';
import { isStreamMediaId } from '@/player/remote-stream';
import type { PlayerController } from '@/player/types';
import { EDIT_TRIM_ROUTE } from '@/screens/downloads/components/DownloadEditActions';
import { AVAILABILITY_KEYS } from '@/screens/media-edit/useRunEdit';
import { formatUsagePercent } from '@/storage-manager/utils/format-bytes';
import type { LibraryItem } from '@modules/vidorax-media/src/VidoraMedia.types';

import { announcePlayer } from './use-player-not-yet';

const OUTPUT_LABELS: Readonly<Record<PlayerEditInput['kind'], TranslationKey>> = {
  audio: 'mediaEdit.audioLabel',
  mp4: 'mediaEdit.mp4Label',
  compress: 'videoPlayer.compressedLabel',
};

export type PlayerEditSheet = 'converter' | 'compress' | 'progress' | null;

export type PlayerEditToolsInput = {
  mediaId: string | null;
  title: string | null;
  player: VideoPlayer;
  controller: PlayerController;
  isPlaying: boolean;
  /** A video frame has shown (never for audio). */
  hasVideoFrame: boolean;
  /** A file another app opened (no library row). */
  incoming: boolean;
  /** The session's position (lags the player's own clock a little; the player's is read first). */
  positionSeconds: number;
  endLongPress: () => void;
  /** Out of full screen before another screen opens (Trim). */
  restorePresentation: () => Promise<void>;
};

export function usePlayerEditTools(input: PlayerEditToolsInput) {
  const { t } = useTranslation();
  const { mediaId, title, player, controller, isPlaying, hasVideoFrame, incoming, positionSeconds, endLongPress, restorePresentation } =
    input;
  const [sheet, setSheet] = useState<PlayerEditSheet>(null);
  // The moment playing: the player's own clock, the session's position when it can't be read.
  const positionRef = useRef(positionSeconds);
  useEffect(() => {
    positionRef.current = positionSeconds;
  }, [positionSeconds]);
  const readPlayerTime = useCallback(() => {
    try {
      const value = player.currentTime;
      return Number.isFinite(value) && value >= 0 ? value : positionRef.current;
    } catch {
      return positionRef.current;
    }
  }, [player]);
  const [loaded, setLoaded] = useState<{ id: string; item: LibraryItem | null } | null>(null);
  const screenshotBusy = useRef(false);
  const job = useEditJobStore((s) => s.job);
  const origin = usePlayerEditOrigin((s) => s.sourceId);

  const source = playerToolSource({
    mediaId,
    isStream: isStreamMediaId(mediaId),
    isDevice: isDeviceMediaId(mediaId),
    isIncoming: incoming,
  });
  const editorAvailable = getEditPort() != null;
  // What this build can do does not change while the app runs: asked once.
  const compressInBuild = useMemo(() => nativeEditKinds().includes('compress'), []);
  const frameExportInBuild = useMemo(() => getFramePort() != null, []);

  // The library item behind what plays (the editors' only source). Read again when the video changes.
  useEffect(() => {
    const engine = getV2Engine();
    if (!mediaId || source !== 'library' || !editorAvailable || !engine) {
      return undefined;
    }
    let live = true;
    engine
      .getLibraryItem(mediaId)
      .then((found) => {
        if (live) {
          setLoaded({ id: mediaId, item: found ?? null });
        }
      })
      .catch(() => {
        if (live) {
          setLoaded({ id: mediaId, item: null });
        }
      });
    return () => {
      live = false;
    };
  }, [editorAvailable, mediaId, source]);

  const item = loaded && loaded.id === mediaId ? loaded.item : null;
  const canEdit = canEditInPlayer({
    source,
    libraryItemFound: item != null,
    isVideo: item != null && !isAudioOnlySource(item),
    editorAvailable,
  });
  const canCompress = canEdit && compressInBuild;
  const screenshotAvailable = canScreenshot({ source, hasVideoFrame, nativeAvailable: frameExportInBuild });

  const jobRunning = isEditRunning(job);
  const runningHere = jobRunning && item != null && job.sourceId === item.id;
  const startedFromPlayer = jobRunning && origin != null && job.sourceId === origin;
  const runningKind: EditKind | null = jobRunning ? job.kind : null;
  const runningValue = runningHere
    ? job.phase === 'running'
      ? (formatUsagePercent(job.progress) ?? t('videoPlayer.editRowRunning'))
      : t('mediaEdit.cancelling')
    : null;

  // Pause the player while an edit started here runs (whatever started playing it again).
  useEffect(() => {
    if (shouldHoldPause({ editRunning: jobRunning, startedFromPlayer, isPlaying })) {
      controller.pause();
      announcePlayer(t('videoPlayer.editHeldPause'));
    }
  }, [controller, isPlaying, jobRunning, startedFromPlayer, t]);

  const run = useCallback(
    async (edit: PlayerEditInput) => {
      const editPort = getEditPort();
      const outcome = await runPlayerEdit(
        {
          job: getEditJob(),
          getItem: (id) => getV2Engine()?.getLibraryItem(id) ?? Promise.resolve(null),
          getFreeBytes: () => (editPort ? editPort.getStorageStats().then((stats) => stats.freeBytes) : Promise.resolve(null)),
          pausePlayer: () => controller.pause(),
          onStarted: (started) => {
            setPlayerEditOrigin(started.id);
            setSheet('progress');
          },
          outputLabel: (kind) => t(OUTPUT_LABELS[kind]),
        },
        edit,
      );
      if (outcome.kind === 'finished') {
        clearPlayerEditOrigin(edit.id);
        setSheet((current) => (current === 'progress' ? null : current));
      }
      const key = playerEditMessageKey(outcome);
      if (key) {
        announcePlayer(t(key));
      }
    },
    [controller, t],
  );

  /** While this video's edit runs, its rows open its progress. */
  const showRunning = useCallback((): boolean => {
    if (!runningHere) {
      return false;
    }
    setSheet('progress');
    return true;
  }, [runningHere]);

  const screenshot = useCallback(async () => {
    endLongPress();
    const port = getFramePort();
    if (!port || screenshotBusy.current) {
      return;
    }
    screenshotBusy.current = true;
    let frame: VideoThumbnail | null = null;
    try {
      const seconds = readPlayerTime();
      await ensureGalleryPermission();
      // No maxWidth / maxHeight: expo-video returns the frame at the video's own size (MediaMetadataRetriever
      // getFrameAtTime, OPTION_CLOSEST).
      const frames = await player.generateThumbnailsAsync(seconds);
      frame = frames[0] ?? null;
      if (!frame) {
        throw new Error('no_frame');
      }
      const name = screenshotTitle(title, seconds, t('videoPlayer.screenshot'));
      await port.saveFrameToGallery(frame, name);
      announcePlayer(t('videoPlayer.screenshotSaved'));
      // Then offered to the share sheet (only where the app's dialog host is mounted, as it is once the app runs).
      const share = hasAppDialogHost() && (await showAppDialog({
        title: t('videoPlayer.screenshotSavedTitle'),
        message: t('videoPlayer.screenshotSavedMessage', { width: frame.width, height: frame.height }),
        confirmLabel: t('common.share'),
        cancelLabel: t('common.done'),
      }));
      if (share) {
        await port.shareFrame(frame, name).catch(() => announcePlayer(t('videoPlayer.screenshotShareFailed')));
      }
    } catch (error) {
      announcePlayer(
        thumbnailSaveFailure(error) === 'permission' ? t('thumbnailSave.needsPermission') : t('videoPlayer.screenshotFailed'),
      );
    } finally {
      try {
        frame?.release();
      } catch {
        // Already released with its player.
      }
      screenshotBusy.current = false;
    }
  }, [endLongPress, player, readPlayerTime, t, title]);

  const openTrim = useCallback(() => {
    endLongPress();
    if (!item || showRunning()) {
      return;
    }
    const availability = editAvailability('trim', item);
    const range = availability === 'ok' ? trimRangeFromPosition(readPlayerTime(), item.durationMs) : null;
    if (availability !== 'ok' || !range) {
      announcePlayer(t(availability !== 'ok' ? AVAILABILITY_KEYS[availability] : 'mediaEdit.tooShort'));
      return;
    }
    // The Trim screen has its own preview player: this one is paused so the two never play together.
    controller.pause();
    const id = item.id;
    void restorePresentation().then(() => {
      navigation.push({ pathname: EDIT_TRIM_ROUTE, params: { id, startMs: String(range.startMs) } });
    });
  }, [controller, endLongPress, item, readPlayerTime, restorePresentation, showRunning, t]);

  const extractAudio = useCallback(() => {
    endLongPress();
    if (!item || showRunning()) {
      return;
    }
    void run({ id: item.id, kind: 'audio' });
  }, [endLongPress, item, run, showRunning]);

  const openConverter = useCallback(() => {
    endLongPress();
    if (!item || showRunning()) {
      return;
    }
    setSheet('converter');
  }, [endLongPress, item, showRunning]);

  const openCompress = useCallback(() => {
    endLongPress();
    if (!item || showRunning()) {
      return;
    }
    setSheet('compress');
  }, [endLongPress, item, showRunning]);

  const onConvert = useCallback(
    (kind: 'mp4' | 'audio') => {
      setSheet(null);
      if (item) {
        void run({ id: item.id, kind });
      }
    },
    [item, run],
  );

  const onCompress = useCallback(
    (preset: CompressPreset) => {
      setSheet(null);
      if (item) {
        void run({ id: item.id, kind: 'compress', preset });
      }
    },
    [item, run],
  );

  const closeSheets = useCallback(() => setSheet(null), []);

  const option = useMemo<NonNullable<PlayerOptionContext['editTools']>>(
    () => ({
      canScreenshot: screenshotAvailable,
      canEdit,
      canCompress,
      running: runningValue,
      screenshot: () => {
        void screenshot();
      },
      openTrim,
      extractAudio,
      openConverter,
      openCompress,
    }),
    [canCompress, canEdit, extractAudio, openCompress, openConverter, openTrim, runningValue, screenshot, screenshotAvailable],
  );

  // The progress sheet only while that edit runs; it closes by itself when it ends.
  const progressVisible = sheet === 'progress' && runningHere;
  const sheetOpen = sheet === 'converter' || sheet === 'compress' || progressVisible;

  return {
    option,
    sheetOpen,
    closeSheets,
    sheets: {
      sheet: progressVisible ? 'progress' : sheet === 'progress' ? null : sheet,
      item,
      runningKind,
      onClose: closeSheets,
      onConvert,
      onCompress,
    } satisfies PlayerEditToolsSheetsState,
  };
}

export type PlayerEditToolsSheetsState = {
  sheet: PlayerEditSheet;
  item: LibraryItem | null;
  runningKind: EditKind | null;
  onClose: () => void;
  onConvert: (kind: 'mp4' | 'audio') => void;
  onCompress: (preset: CompressPreset) => void;
};
