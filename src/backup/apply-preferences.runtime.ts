/**
 * P11 #700 — the phone's allow-listed preferences read from MMKV, and a restored value applied through its own
 * package's setter. Every preference store reads MMKV once when it starts, so writing MMKV alone would leave the
 * screens with the old value (and the next change there would write the old list back); the setters update both.
 */

import { setLibraryFolderHidden, useLibraryStatsStore } from '@/library/library-stats-store';
import { writePersistedLibraryViewMode } from '@/library/view-mode';
import type { LibraryViewMode } from '@/library/types';
import { setWatchHistoryPaused } from '@/playback/history-pause-preference';
import { setAutoPlayNext, setNextEpisodePrompt } from '@/player/auto-next-preference';
import type { ControlsLayout } from '@/player/controls-layout';
import { setControlsLayout } from '@/player/controls-layout-preference';
import type { DurationLabelMode } from '@/player/duration-label';
import { writePersistedDurationLabelMode } from '@/player/duration-label-preference';
import type { EndOfPlaybackAction } from '@/player/end-of-playback';
import { SWITCHABLE_GESTURES, type GestureSettings } from '@/player/gesture-settings';
import { setGestureOn, setGestureSensitivity, setGesturesEnabled } from '@/player/gesture-settings-preference';
import { restoreSavedLoopRecords, setEndOfPlaybackAction } from '@/player/repeat-preference';
import { setSeekStepSeconds } from '@/player/seek-step-preference';
import { setSubtitleAutoDetect, updateVideoSubtitleRecord } from '@/player/subtitles/subtitle-preference';
import {
  EMPTY_SUBTITLE_RECORD,
  pickedCopies,
  readSubtitleRecords,
  subtitleRecordFor,
} from '@/player/subtitles/subtitle-record';
import type { SubtitleStyle } from '@/player/subtitles/subtitle-style';
import { setSubtitleStyle } from '@/player/subtitles/subtitle-style-preference';
import { DEFAULT_VIDEO_FIT, fitFor, readRememberedFits } from '@/player/video-display';
import { setFillCutout, setInfoOverlay, setVideoFit } from '@/player/video-display-preference';
import { setBlockScreenCapture } from '@/privacy/screen-capture-preference';
import { mmkvKeys } from '@/storage/constants';
import { mmkvGetBoolean, mmkvGetNumber, mmkvGetObject, mmkvGetString } from '@/storage/mmkv';

import type { PreferenceSpec } from './backup-preferences';

/** What MMKV holds for an allow-listed key (undefined when nothing is stored). */
export function readStoredPreference(spec: PreferenceSpec): unknown {
  switch (spec.storage) {
    case 'string':
      return mmkvGetString(spec.key);
    case 'number':
      return mmkvGetNumber(spec.key);
    case 'boolean':
      return mmkvGetBoolean(spec.key);
    default:
      return mmkvGetObject<unknown>(spec.key) ?? undefined;
  }
}

function applyFits(phoneValue: unknown, value: unknown): void {
  const before = readRememberedFits(phoneValue);
  const after = readRememberedFits(value);
  const kept = new Set(after.map(([id]) => id));
  for (const [id] of before) {
    if (!kept.has(id)) {
      setVideoFit(id, DEFAULT_VIDEO_FIT);
    }
  }
  for (const [id, fit] of after) {
    if (fitFor(before, id) !== fit) {
      setVideoFit(id, fit);
    }
  }
}

function applySubtitleRecords(phoneValue: unknown, value: unknown): void {
  const before = readSubtitleRecords(phoneValue);
  const after = readSubtitleRecords(value);
  const kept = new Set(after.map(([id]) => id));
  for (const [id, record] of before) {
    if (!kept.has(id)) {
      updateVideoSubtitleRecord(id, () => EMPTY_SUBTITLE_RECORD, pickedCopies(record));
    }
  }
  for (const [id, record] of after) {
    if (JSON.stringify(subtitleRecordFor(before, id)) !== JSON.stringify(record)) {
      updateVideoSubtitleRecord(id, () => record);
    }
  }
}

function applyHiddenFolders(value: unknown): void {
  const next = Array.isArray(value) ? (value as string[]) : [];
  const current = useLibraryStatsStore.getState().excludedFolderIds;
  for (const key of current) {
    if (!next.includes(key)) {
      setLibraryFolderHidden(key, false);
    }
  }
  for (const key of next) {
    if (!current.includes(key)) {
      setLibraryFolderHidden(key, true);
    }
  }
}

/** Applies one restored value (already checked by its spec) as a change in the app would. */
export function applyRestoredPreference(key: string, value: unknown, phoneValue: unknown): void {
  switch (key) {
    case mmkvKeys.playerDurationLabelMode:
      writePersistedDurationLabelMode(value as DurationLabelMode);
      return;
    case mmkvKeys.playerSeekStepSeconds:
      setSeekStepSeconds(value as number);
      return;
    case mmkvKeys.playerVideoFits:
      applyFits(phoneValue, value);
      return;
    case mmkvKeys.playerFillCutout:
      setFillCutout(value === true);
      return;
    case mmkvKeys.playerInfoOverlay:
      setInfoOverlay(value === true);
      return;
    case mmkvKeys.playerSubtitles:
      applySubtitleRecords(phoneValue, value);
      return;
    case mmkvKeys.playerSubtitleAutoDetect:
      setSubtitleAutoDetect(value === true);
      return;
    case mmkvKeys.playerSubtitleStyle:
      setSubtitleStyle(value as SubtitleStyle);
      return;
    case mmkvKeys.playerEndOfPlayback:
      setEndOfPlaybackAction(value as EndOfPlaybackAction);
      return;
    case mmkvKeys.playerSavedLoops:
      restoreSavedLoopRecords(value);
      return;
    case mmkvKeys.playerAutoPlayNext:
      setAutoPlayNext(value === true);
      return;
    case mmkvKeys.playerNextEpisodePrompt:
      setNextEpisodePrompt(value === true);
      return;
    case mmkvKeys.playerGestures: {
      const settings = value as GestureSettings;
      setGesturesEnabled(settings.enabled);
      for (const gesture of SWITCHABLE_GESTURES) {
        setGestureOn(gesture, settings[gesture]);
      }
      setGestureSensitivity(settings.sensitivity);
      return;
    }
    case mmkvKeys.playerControlsLayout:
      setControlsLayout(value as ControlsLayout);
      return;
    case mmkvKeys.playerDisableHistory:
      setWatchHistoryPaused(value === true);
      return;
    case mmkvKeys.libraryExcludedFolders:
      applyHiddenFolders(value);
      return;
    case mmkvKeys.libraryViewMode:
      writePersistedLibraryViewMode(value as LibraryViewMode);
      return;
    case mmkvKeys.privacyBlockScreenCapture:
      setBlockScreenCapture(value === true);
      return;
    default:
    // Not on the allow-list: never written.
  }
}
