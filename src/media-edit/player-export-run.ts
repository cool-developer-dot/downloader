/**
 * P12 Export extras, started from the Player: Create GIF (#676), Merge videos (#682), Change speed (#684). The same
 * one-at-a-time job as every edit (edit-job.ts), so none of them runs with another edit (from the Player or Download
 * details). Everything is re-checked right before acting — the items are still in the library, the export makes
 * sense, there is room for the output — then the player is paused and the job starts. Merge and Change speed make a
 * NEW library item (`startEdit`); Create GIF makes a GIF in the Gallery (`startGifExport`, through `job.startTask`).
 * The originals are only read. Pure: everything is injected.
 */

import type { GifResult, LibraryItem } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { TranslationKey } from '@/localization/types';

import { isEditRunning, type EditFailure, type EditJob, type EditJobState } from './edit-job';
import { editOutputTitle, hasRoomForEdit, isAudioOnlySource, type TrimRange } from './edit-plan';
import type { GifPort } from './export-extras-port';
import { gifAvailability, gifPreview, gifRequest, gifTitle, type GifAvailability, type GifChoice } from './gif-plan';
import { isMergeCandidate, mergeAvailability, mergeEstimateBytes, mergeRequest, type MergeAvailability } from './merge-plan';
import {
  SPEED_DEFAULT,
  speedAvailability,
  speedEstimateBytes,
  speedRange,
  speedRequest,
  type SpeedAvailability,
} from './speed-plan';

export type PlayerExportInput =
  /** A GIF of the playing library video. */
  | { kind: 'gif'; id: string; choice: GifChoice }
  /** `ids` in order; `id` (the video playing, the one it starts from) is one of them. */
  | { kind: 'merge'; id: string; ids: readonly string[] }
  /** `part` null: the whole video. */
  | { kind: 'speed'; id: string; speed: number; part: TrimRange | null };

export type PlayerExportRefusal = Exclude<GifAvailability | MergeAvailability | SpeedAvailability, 'ok'>;

export type PlayerExportOutcome =
  /** No native export in this build. */
  | { kind: 'unavailable' }
  /** Another edit is running (from anywhere in the app). */
  | { kind: 'busy' }
  /** An item is gone from the library. */
  | { kind: 'missing' }
  | { kind: 'not-possible'; reason: PlayerExportRefusal }
  /** Not enough free space (checked here, and again natively: then `finished` / no-space). */
  | { kind: 'no-space' }
  /**
   * The job ran: done, cancelled or failed. `gif` is the GIF made (Create GIF, done); `permission` that saving to the
   * Gallery needs the storage permission (Android 9 and older).
   */
  | { kind: 'finished'; state: EditJobState; gif: GifResult | null; permission: boolean };

export type PlayerExportDeps = {
  job: Pick<EditJob, 'state' | 'start' | 'startTask'> | null;
  /** The native GIF export; null on builds without it. */
  gif: Pick<GifPort, 'startGifExport'> | null;
  getItem: (id: string) => Promise<LibraryItem | null>;
  /** Library items by id, in any order; ids that are gone are left out. */
  getItems: (ids: readonly string[]) => Promise<LibraryItem[]>;
  /** Free bytes for the pre-check; null when unknown (then the native check decides). */
  getFreeBytes: () => Promise<number | null>;
  pausePlayer: () => void;
  /** Right before the job starts, with the job's source id (the Player shows its progress and holds the pause). */
  onStarted: (input: PlayerExportInput, sourceId: string) => void;
  /** Merge and Change speed: the label the new item's title gets, "<title> (<label>)". */
  outputLabel: (input: PlayerExportInput) => string;
  /** Create GIF: the name its Gallery file gets when the video has no title. */
  gifFallbackTitle: string;
};

type Prepared =
  | { kind: 'refused'; outcome: PlayerExportOutcome }
  | { kind: 'ready'; neededBytes: number; sourceId: string; start: (job: NonNullable<PlayerExportDeps['job']>) => Promise<EditJobState> };

function codeOf(error: unknown): unknown {
  return error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
}

export async function runPlayerExport(deps: PlayerExportDeps, input: PlayerExportInput): Promise<PlayerExportOutcome> {
  const job = deps.job;
  if (!job || (input.kind === 'gif' && !deps.gif)) {
    return { kind: 'unavailable' };
  }
  if (isEditRunning(job.state())) {
    return { kind: 'busy' };
  }
  let made: GifResult | null = null;
  let permission = false;
  const prepared = await prepare(deps, input, (result) => {
    made = result;
  }, () => {
    permission = true;
  });
  if (prepared.kind === 'refused') {
    return prepared.outcome;
  }
  const free = await deps.getFreeBytes().catch(() => null);
  if (!hasRoomForEdit(free, prepared.neededBytes)) {
    return { kind: 'no-space' };
  }
  // Read again after the awaits: an edit may have started meanwhile (the job would refuse it too, as 'busy').
  if (isEditRunning(job.state())) {
    return { kind: 'busy' };
  }
  deps.pausePlayer();
  deps.onStarted(input, prepared.sourceId);
  const state = await prepared.start(job);
  return { kind: 'finished', state, gif: state.phase === 'done' ? made : null, permission };
}

async function prepare(
  deps: PlayerExportDeps,
  input: PlayerExportInput,
  onGif: (result: GifResult) => void,
  onPermission: () => void,
): Promise<Prepared> {
  const refused = (outcome: PlayerExportOutcome): Prepared => ({ kind: 'refused', outcome });
  if (input.kind === 'merge') {
    if (!input.ids.includes(input.id)) {
      return refused({ kind: 'not-possible', reason: 'too-few' });
    }
    const found = await deps.getItems(input.ids).catch(() => [] as LibraryItem[]);
    const byId = new Map(found.map((item) => [item.id, item]));
    const sources = input.ids.map((id) => byId.get(id) ?? null);
    if (sources.some((source) => source == null)) {
      return refused({ kind: 'missing' });
    }
    const ordered = sources as LibraryItem[];
    const availability = mergeAvailability(ordered);
    if (availability !== 'ok') {
      return refused({ kind: 'not-possible', reason: availability });
    }
    const startedFrom = byId.get(input.id)!;
    const request = mergeRequest(input.id, ordered, editOutputTitle(startedFrom.title, deps.outputLabel(input)));
    return { kind: 'ready', neededBytes: mergeEstimateBytes(ordered), sourceId: input.id, start: (job) => job.start(request) };
  }
  const source = await deps.getItem(input.id).catch(() => null);
  if (!source) {
    return refused({ kind: 'missing' });
  }
  if (input.kind === 'speed') {
    const availability = speedAvailability(source, input.speed, input.part);
    const range = speedRange(input.part, source.durationMs);
    if (availability !== 'ok' || !range.ok) {
      return refused({ kind: 'not-possible', reason: availability !== 'ok' ? availability : 'no-duration' });
    }
    const request = speedRequest(source, input.speed, range.range, editOutputTitle(source.title, deps.outputLabel(input)));
    return {
      kind: 'ready',
      neededBytes: speedEstimateBytes(source, range.range, input.speed),
      sourceId: source.id,
      start: (job) => job.start(request),
    };
  }
  const availability = gifAvailability(source);
  const preview = availability === 'ok' ? gifPreview(source, input.choice) : null;
  const request = preview
    ? gifRequest(source, input.choice, gifTitle(source.title, preview.range.startMs, deps.gifFallbackTitle))
    : null;
  if (availability !== 'ok' || !preview || !request) {
    return refused({ kind: 'not-possible', reason: availability !== 'ok' ? availability : 'too-short' });
  }
  const gif = deps.gif!;
  return {
    kind: 'ready',
    neededBytes: preview.spaceBytes,
    sourceId: source.id,
    start: (job) =>
      job.startTask({
        sourceId: source.id,
        kind: 'gif',
        run: async () => {
          try {
            const result = await gif.startGifExport(request);
            onGif(result);
            return result.uri;
          } catch (error) {
            if (codeOf(error) === 'ERR_STORAGE_PERMISSION') {
              onPermission();
            }
            throw error;
          }
        },
      }),
  };
}

/** Why a tool's sheet doesn't open for this video (said when its row is pressed); null when it opens. */
export function playerExportRefusal(kind: PlayerExportInput['kind'], source: LibraryItem): PlayerExportRefusal | null {
  if (kind === 'gif') {
    const availability = gifAvailability(source);
    return availability === 'ok' ? null : availability;
  }
  if (kind === 'speed') {
    const availability = speedAvailability(source, SPEED_DEFAULT, null);
    return availability === 'ok' ? null : availability;
  }
  if (isAudioOnlySource(source)) {
    return 'audio-source';
  }
  return isMergeCandidate(source) ? null : 'no-duration';
}

/** The message each outcome is announced with; null says nothing (a GIF made shows its own dialog). */
export function playerExportMessageKey(outcome: PlayerExportOutcome): TranslationKey | null {
  switch (outcome.kind) {
    case 'unavailable':
      return 'mediaEdit.failed';
    case 'busy':
      return 'mediaEdit.busy';
    case 'missing':
      return 'mediaEdit.missing';
    case 'no-space':
      return 'mediaEdit.noSpace';
    case 'not-possible':
      return REFUSAL_KEYS[outcome.reason];
    case 'finished':
      if (outcome.permission) {
        return 'thumbnailSave.needsPermission';
      }
      return finishedKey(outcome.state);
    default:
      return null;
  }
}

const REFUSAL_KEYS: Record<PlayerExportRefusal, TranslationKey> = {
  'audio-source': 'mediaEdit.audioSource',
  'no-duration': 'mediaEdit.noDuration',
  'too-short': 'mediaEdit.tooShort',
  'no-size': 'videoPlayer.exportNoSize',
  'too-few': 'videoPlayer.mergeTooFew',
  'too-many': 'videoPlayer.mergeTooMany',
  duplicate: 'videoPlayer.mergeDuplicate',
  'bad-speed': 'videoPlayer.speedInvalid',
};

const FAILURE_KEYS: Record<EditFailure, TranslationKey> = {
  busy: 'mediaEdit.busy',
  'no-space': 'mediaEdit.noSpace',
  refused: 'mediaEdit.refused',
  missing: 'mediaEdit.missing',
  failed: 'mediaEdit.failed',
};

function finishedKey(state: EditJobState): TranslationKey | null {
  switch (state.phase) {
    case 'done':
      return state.kind === 'gif' ? 'videoPlayer.gifSaved' : 'mediaEdit.done';
    case 'cancelled':
      return 'mediaEdit.cancelled';
    case 'failed':
      return FAILURE_KEYS[state.reason];
    default:
      return null;
  }
}
