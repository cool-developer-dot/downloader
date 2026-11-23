/**
 * P10: an edit started from the Player (Extract audio #678, Video converter #679, Compress video #680; Trim #677 runs
 * on the Trim screen). The same one-at-a-time job the Downloader's edits use (edit-job.ts), so an edit started here
 * and one started from Download details can never run together. Everything is re-checked right before acting — the
 * item is still in the library, the edit still makes sense, there is room for the output — then the player is paused
 * and the job starts. Pure: everything is injected.
 */

import type { LibraryItem } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { TranslationKey } from '@/localization/types';

import {
  compressAvailability,
  compressEstimateBytes,
  compressRequest,
  COMPRESS_TARGETS,
  type CompressAvailability,
  type CompressPreset,
} from './compress-plan';
import { isEditRunning, type EditFailure, type EditJob, type EditJobState } from './edit-job';
import {
  COPY_FACTOR,
  editAvailability,
  editOutputTitle,
  editRequest,
  estimateEditBytes,
  hasRoomForEdit,
  trackPlan,
  type EditAvailability,
} from './edit-plan';

export type PlayerEditInput =
  | { id: string; kind: 'audio' | 'mp4' }
  | { id: string; kind: 'compress'; preset: CompressPreset };

export type PlayerEditOutcome =
  /** No native editor in this build. */
  | { kind: 'unavailable' }
  /** Another edit is running (from anywhere in the app). */
  | { kind: 'busy' }
  /** The item is gone from the library. */
  | { kind: 'missing' }
  /** The edit makes no sense for this item. */
  | { kind: 'not-possible'; reason: Exclude<EditAvailability | CompressAvailability, 'ok'> }
  /** Not enough free space for the output (checked here, and again by the native editor: then `finished` / no-space). */
  | { kind: 'no-space' }
  /** The job ran: done, cancelled or failed (`failed` with `no-space` when the native check refused it). */
  | { kind: 'finished'; state: EditJobState };

export type PlayerEditRunDeps = {
  job: Pick<EditJob, 'state' | 'start'> | null;
  getItem: (id: string) => Promise<LibraryItem | null>;
  /** Free bytes for the pre-check; null when unknown (then the native editor's own check decides). */
  getFreeBytes: () => Promise<number | null>;
  pausePlayer: () => void;
  /** Right before the job starts (the Player shows its progress). */
  onStarted: (input: PlayerEditInput) => void;
  /** The label the new item's title gets: "<title> (<label>)". */
  outputLabel: (kind: PlayerEditInput['kind']) => string;
};

export async function runPlayerEdit(deps: PlayerEditRunDeps, input: PlayerEditInput): Promise<PlayerEditOutcome> {
  const job = deps.job;
  if (!job) {
    return { kind: 'unavailable' };
  }
  if (isEditRunning(job.state())) {
    return { kind: 'busy' };
  }
  const source = await deps.getItem(input.id).catch(() => null);
  if (!source) {
    return { kind: 'missing' };
  }
  const availability = input.kind === 'compress' ? compressAvailability(source, input.preset) : editAvailability(input.kind, source);
  if (availability !== 'ok') {
    return { kind: 'not-possible', reason: availability };
  }
  // Compress: its estimate with the native check's 10 % headroom (MediaEditor.check: × COPY_FACTOR), so a phone
  // that passes here isn't refused there a moment later.
  const needed =
    input.kind === 'compress'
      ? Math.ceil(compressEstimateBytes(source.durationMs, COMPRESS_TARGETS[input.preset], source.hasAudio) * COPY_FACTOR)
      : estimateEditBytes(source, trackPlan(input.kind, source));
  const free = await deps.getFreeBytes().catch(() => null);
  if (!hasRoomForEdit(free, needed)) {
    return { kind: 'no-space' };
  }
  // Read again after the awaits: an edit may have started meanwhile (the job would refuse it too, as 'busy').
  if (isEditRunning(job.state())) {
    return { kind: 'busy' };
  }
  const title = editOutputTitle(source.title, deps.outputLabel(input.kind));
  const request = input.kind === 'compress' ? compressRequest(source, input.preset, title) : editRequest(input.kind, source, title);
  deps.pausePlayer();
  deps.onStarted(input);
  const state = await job.start(request);
  return { kind: 'finished', state };
}

/** The message each outcome is announced with (keys of the existing `mediaEdit` strings); null says nothing. */
export function playerEditMessageKey(outcome: PlayerEditOutcome): TranslationKey | null {
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
      return NOT_POSSIBLE_KEYS[outcome.reason];
    case 'finished':
      return finishedKey(outcome.state);
    default:
      return null;
  }
}

const NOT_POSSIBLE_KEYS: Record<Exclude<EditAvailability | CompressAvailability, 'ok'>, TranslationKey> = {
  'already-mp4': 'mediaEdit.alreadyMp4',
  'no-audio': 'mediaEdit.noAudio',
  'audio-source': 'mediaEdit.audioSource',
  'no-duration': 'mediaEdit.noDuration',
  'too-short': 'mediaEdit.tooShort',
  'no-gain': 'videoPlayer.compressNoGain',
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
      return 'mediaEdit.done';
    case 'cancelled':
      return 'mediaEdit.cancelled';
    case 'failed':
      return FAILURE_KEYS[state.reason];
    default:
      return null;
  }
}
