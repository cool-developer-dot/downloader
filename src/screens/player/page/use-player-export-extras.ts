/**
 * P12 Export extras (#676, #682, #684): what the Player's ⋮ → Tools rows Create GIF, Merge videos and Change speed
 * do, and the sheets they open.
 *
 * - Create GIF: a part (from the moment playing, 1–15 s) at 320 / 480 px and 5 / 10 / 15 fps, with its estimated size,
 *   made by the app's own encoder and saved in Pictures/VidoraX; then offered to the share sheet (as a screenshot is).
 * - Merge videos: this video and others from the Library, in an order the user sets, joined into a new Library item.
 * - Change speed: the whole video or a part at 0.25×–4×, as a new Library item.
 *
 * All three take library videos only (P10's rule: `canEdit` from use-player-edit-tools.ts, which also loads the item),
 * run through the app's one edit job with progress and Cancel, check free space first, pause the video, and keep it
 * paused while they run (P10's hold, through the edit origin). The originals are never changed.
 */

import type { VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { hasAppDialogHost, showAppDialog } from '@/components/modals/app-dialog';
import { getV2Engine } from '@/downloads/v2/engine-port';
import { ensureGalleryPermission } from '@/downloads/v2/gallery-permission';
import { useTranslation } from '@/localization';
import { formatFileSize } from '@/media-detection/utils/format';
import { isEditRunning } from '@/media-edit/edit-job';
import { getEditJob, useEditJobStore } from '@/media-edit/edit-job-store';
import type { EditKind, TrimRange } from '@/media-edit/edit-plan';
import { getEditPort } from '@/media-edit/edit-port';
import { exportExtrasInBuild, getGifPort } from '@/media-edit/export-extras-port';
import type { GifChoice } from '@/media-edit/gif-plan';
import {
  playerExportMessageKey,
  playerExportRefusal,
  runPlayerExport,
  type PlayerExportInput,
  type PlayerExportOutcome,
} from '@/media-edit/player-export-run';
import { clearPlayerEditOrigin, setPlayerEditOrigin } from '@/media-edit/player-tools-port';
import { formatExportSpeed } from '@/media-edit/speed-plan';
import type { PlayerOptionContext } from '@/player/options';
import type { PlayerController } from '@/player/types';
import { formatUsagePercent } from '@/storage-manager/utils/format-bytes';
import type { GifResult, LibraryItem } from '@modules/vidorax-media/src/VidoraMedia.types';

import { announcePlayer } from './use-player-not-yet';

export type PlayerExportSheet = 'gif' | 'merge' | 'speed' | 'progress' | null;

export type PlayerExportExtrasInput = {
  /** The library item playing (P10's hook loads it); null for anything else. */
  item: LibraryItem | null;
  /** P10's rule: a library video, on a build with the editor. */
  canEdit: boolean;
  player: VideoPlayer;
  controller: PlayerController;
  /** The session's position (lags the player's own clock a little; the player's is read first). */
  positionSeconds: number;
  endLongPress: () => void;
};

export function usePlayerExportExtras(input: PlayerExportExtrasInput) {
  const { t } = useTranslation();
  const { item, canEdit, player, controller, positionSeconds, endLongPress } = input;
  const [sheet, setSheet] = useState<PlayerExportSheet>(null);
  // The moment playing when a sheet opened (ms): where the GIF starts, and Change speed's part.
  const [openedAtMs, setOpenedAtMs] = useState(0);
  const positionRef = useRef(positionSeconds);
  useEffect(() => {
    positionRef.current = positionSeconds;
  }, [positionSeconds]);
  const readPositionMs = useCallback(() => {
    try {
      const value = player.currentTime;
      return Math.round((Number.isFinite(value) && value >= 0 ? value : positionRef.current) * 1000);
    } catch {
      return Math.round(positionRef.current * 1000);
    }
  }, [player]);
  const job = useEditJobStore((s) => s.job);
  // What this build can do does not change while the app runs: asked once.
  const inBuild = useMemo(() => exportExtrasInBuild(), []);

  const jobRunning = isEditRunning(job);
  const runningHere = jobRunning && item != null && job.sourceId === item.id;
  const runningKind: EditKind | null = jobRunning ? job.kind : null;
  const runningValue = runningHere
    ? job.phase === 'running'
      ? (formatUsagePercent(job.progress) ?? t('videoPlayer.editRowRunning'))
      : t('mediaEdit.cancelling')
    : null;

  /** While this video's edit runs, the rows open its progress. */
  const showRunning = useCallback((): boolean => {
    if (!runningHere) {
      return false;
    }
    setSheet('progress');
    return true;
  }, [runningHere]);

  const offerGifShare = useCallback(
    async (gif: GifResult) => {
      announcePlayer(t('videoPlayer.gifSaved'));
      const port = getGifPort();
      if (!port || !gif.shareName || !hasAppDialogHost()) {
        return;
      }
      const share = await showAppDialog({
        title: t('videoPlayer.gifSavedTitle'),
        message: t('videoPlayer.gifSavedMessage', {
          width: gif.width,
          height: gif.height,
          seconds: String(Math.round(gif.durationMs / 100) / 10),
          size: formatFileSize(gif.bytes) ?? '',
        }),
        confirmLabel: t('common.share'),
        cancelLabel: t('common.done'),
      });
      if (share) {
        await port.shareGif(gif.shareName).catch(() => announcePlayer(t('videoPlayer.gifShareFailed')));
      }
    },
    [t],
  );

  const run = useCallback(
    async (exportInput: PlayerExportInput) => {
      const editPort = getEditPort();
      const engine = getV2Engine();
      const outcome: PlayerExportOutcome = await runPlayerExport(
        {
          job: getEditJob(),
          gif: getGifPort(),
          getItem: (id) => engine?.getLibraryItem(id) ?? Promise.resolve(null),
          getItems: (ids) => engine?.getLibraryItems([...ids]) ?? Promise.resolve([]),
          getFreeBytes: () => (editPort ? editPort.getStorageStats().then((stats) => stats.freeBytes) : Promise.resolve(null)),
          pausePlayer: () => controller.pause(),
          onStarted: (_started, sourceId) => {
            setPlayerEditOrigin(sourceId);
            setSheet('progress');
          },
          outputLabel: (entry) =>
            entry.kind === 'merge'
              ? t('videoPlayer.mergedLabel')
              : entry.kind === 'speed'
                ? t('videoPlayer.speedLabel', { speed: formatExportSpeed(entry.speed) })
                : t('videoPlayer.createGif'),
          gifFallbackTitle: t('videoPlayer.gifFallbackName'),
        },
        exportInput,
      );
      if (outcome.kind === 'finished') {
        // The job's source is always the video it was started from.
        clearPlayerEditOrigin(exportInput.id);
        setSheet((current) => (current === 'progress' ? null : current));
      }
      if (outcome.kind === 'finished' && outcome.gif) {
        await offerGifShare(outcome.gif);
        return;
      }
      const key = playerExportMessageKey(outcome);
      if (key) {
        announcePlayer(t(key));
      }
    },
    [controller, offerGifShare, t],
  );

  /** Opens a sheet when the tool applies to this video; otherwise says why. */
  const open = useCallback(
    (next: 'gif' | 'merge' | 'speed') => {
      endLongPress();
      if (!item || showRunning()) {
        return;
      }
      const reason = playerExportRefusal(next, item);
      if (reason) {
        const key = playerExportMessageKey({ kind: 'not-possible', reason });
        if (key) {
          announcePlayer(t(key));
        }
        return;
      }
      setOpenedAtMs(readPositionMs());
      setSheet(next);
    },
    [endLongPress, item, readPositionMs, showRunning, t],
  );

  const onCreateGif = useCallback(
    async (choice: GifChoice) => {
      setSheet(null);
      if (!item) {
        return;
      }
      // Android 9 and older ask for the storage permission once, as Screenshot does.
      const decision = await ensureGalleryPermission();
      if (decision === 'denied') {
        announcePlayer(t('thumbnailSave.needsPermission'));
        return;
      }
      await run({ kind: 'gif', id: item.id, choice });
    },
    [item, run, t],
  );

  const onMerge = useCallback(
    (ids: string[]) => {
      setSheet(null);
      if (item) {
        void run({ kind: 'merge', id: item.id, ids });
      }
    },
    [item, run],
  );

  const onSpeed = useCallback(
    (speed: number, part: TrimRange | null) => {
      setSheet(null);
      if (item) {
        void run({ kind: 'speed', id: item.id, speed, part });
      }
    },
    [item, run],
  );

  const closeSheets = useCallback(() => setSheet(null), []);

  const option = useMemo<NonNullable<PlayerOptionContext['exportExtras']>>(
    () => ({
      canGif: canEdit && inBuild.gif,
      canMerge: canEdit && inBuild.merge,
      canSpeed: canEdit && inBuild.speed,
      running: runningValue,
      openGif: () => open('gif'),
      openMerge: () => open('merge'),
      openSpeed: () => open('speed'),
    }),
    [canEdit, inBuild, open, runningValue],
  );

  // The progress sheet only while that edit runs; it closes by itself when it ends.
  const progressVisible = sheet === 'progress' && runningHere;
  const sheetOpen = sheet === 'gif' || sheet === 'merge' || sheet === 'speed' || progressVisible;

  return {
    option,
    sheetOpen,
    closeSheets,
    sheets: {
      sheet: progressVisible ? 'progress' : sheet === 'progress' ? null : sheet,
      item,
      runningKind,
      openedAtMs,
      readPositionMs,
      onClose: closeSheets,
      onCreateGif: (choice: GifChoice) => {
        void onCreateGif(choice);
      },
      onMerge,
      onSpeed,
    } satisfies PlayerExportExtrasSheetsState,
  };
}

export type PlayerExportExtrasSheetsState = {
  sheet: PlayerExportSheet;
  item: LibraryItem | null;
  runningKind: EditKind | null;
  /** The moment playing when the sheet opened (ms). */
  openedAtMs: number;
  readPositionMs: () => number;
  onClose: () => void;
  onCreateGif: (choice: GifChoice) => void;
  onMerge: (ids: string[]) => void;
  onSpeed: (speed: number, part: TrimRange | null) => void;
};
