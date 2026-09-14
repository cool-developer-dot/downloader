/**
 * Pure playback source resolution — no native module imports.
 * Production wiring lives in `resolve-playback-source.runtime.ts`.
 */

import { PlaybackError } from './errors';
import { assertSafeMediaId } from './media-id';
import type { PlaybackSource } from './types';

export type LocalPlaybackRecord = {
  downloadId: string;
  fileName: string;
  localUri: string | null;
  localState: string | null;
  remoteStatus: string | null;
  totalBytes: number | null;
  expectedFileSize: string;
};

export type LocalFilePresence =
  | 'no_file'
  | 'partial'
  | 'complete'
  | 'missing'
  | 'invalid';

export type PlaybackFileAssessment = {
  presence: LocalFilePresence;
  localUri: string | null;
  size: number;
  hasRangePart: boolean;
};

export type VerifyPlaybackFileFn = (
  uri: string,
  expectedBytes: number | null,
  options?: { downloadId?: string },
) => { ok: true; size: number } | { ok: false; reason: 'missing' | 'corrupt' };

export type ResolvePlaybackSourceDeps = {
  getLocalRecord: (mediaId: string) => Promise<LocalPlaybackRecord | null>;
  assessFile: (input: {
    downloadId: string;
    localUri?: string | null;
    expectedBytes?: number | null;
  }) => PlaybackFileAssessment;
  assertManagedPath: (uri: string, mediaId: string) => void;
  verifyFile: VerifyPlaybackFileFn;
  reconcileAvailability: (ids: string[]) => Promise<unknown>;
  invalidateAvailability: (mediaId: string) => void;
  isCompletedStatus: (status: string | null | undefined) => boolean;
  isTempOrWorkspaceArtifact: (
    localUri: string | null | undefined,
    fileName: string | null | undefined,
  ) => boolean;
  normalizeMimeType: (
    mimeType: unknown,
    fileName: string | null,
  ) => string | null;
  resolveDisplayName: (
    title: string | null,
    fileName: string | null,
  ) => string | null;
  /** Optional enrichment — never required for offline playback. */
  getDisplayTitle?: (mediaId: string) => string | null;
  /** Optional persisted MIME from Phase 7A completed identity. */
  getMimeType?: (mediaId: string) => string | null;
  resolveFileUri?: (uri: string) => string;
};

let activeDeps: ResolvePlaybackSourceDeps | null = null;

/** Production / test seam. */
export function configureResolvePlaybackSourceDeps(
  deps: ResolvePlaybackSourceDeps,
): void {
  activeDeps = deps;
}

export function resetResolvePlaybackSourceDeps(): void {
  activeDeps = null;
}

function expectedBytesFromRecord(
  record: LocalPlaybackRecord,
): number | null {
  if (
    typeof record.totalBytes === 'number' &&
    Number.isFinite(record.totalBytes) &&
    record.totalBytes > 0
  ) {
    return Math.trunc(record.totalBytes);
  }
  const raw = record.expectedFileSize;
  if (typeof raw === 'string' && /^\d+$/.test(raw)) {
    try {
      const value = BigInt(raw);
      if (value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
        return Number(value);
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Resolve a player-safe source from mediaId.
 * Never accepts raw paths from navigation.
 */
export async function resolvePlaybackSource(
  rawMediaId: unknown,
  deps: ResolvePlaybackSourceDeps | null = activeDeps,
): Promise<PlaybackSource> {
  if (!deps) {
    throw new PlaybackError(
      'SOURCE_RESOLUTION_FAILED',
      'Unable to prepare this video for playback.',
    );
  }

  let mediaId: string;
  try {
    mediaId = assertSafeMediaId(rawMediaId);
  } catch {
    throw new PlaybackError(
      'MEDIA_NOT_FOUND',
      'This video could not be found in your library.',
    );
  }

  let record: LocalPlaybackRecord | null;
  try {
    record = await deps.getLocalRecord(mediaId);
  } catch {
    throw new PlaybackError(
      'SOURCE_RESOLUTION_FAILED',
      'Unable to prepare this video for playback.',
    );
  }

  if (!record) {
    throw new PlaybackError(
      'MEDIA_NOT_FOUND',
      'This video could not be found in your library.',
    );
  }

  // Identity must match — never accept another media's record/path.
  if (record.downloadId !== mediaId) {
    throw new PlaybackError(
      'SOURCE_RESOLUTION_FAILED',
      'Unable to prepare this video for playback.',
    );
  }

  const completed =
    deps.isCompletedStatus(record.remoteStatus) ||
    record.localState === 'complete';

  if (!completed) {
    throw new PlaybackError(
      'SOURCE_RESOLUTION_FAILED',
      'Unable to prepare this video for playback.',
    );
  }

  if (deps.isTempOrWorkspaceArtifact(record.localUri, record.fileName)) {
    throw new PlaybackError(
      'SOURCE_RESOLUTION_FAILED',
      'Unable to prepare this video for playback.',
    );
  }

  const assessment = deps.assessFile({
    downloadId: mediaId,
    localUri: record.localUri,
    expectedBytes: expectedBytesFromRecord(record),
  });

  if (
    assessment.presence === 'missing' ||
    assessment.presence === 'no_file' ||
    !assessment.localUri
  ) {
    deps.invalidateAvailability(mediaId);
    try {
      await deps.reconcileAvailability([mediaId]);
    } catch {
      // Reconcile best-effort — still surface missing file.
    }
    throw new PlaybackError(
      'FILE_UNAVAILABLE',
      'File is no longer available.',
    );
  }

  if (assessment.presence === 'invalid' || assessment.presence === 'partial') {
    throw new PlaybackError(
      assessment.presence === 'invalid'
        ? 'CORRUPT_MEDIA'
        : 'SOURCE_RESOLUTION_FAILED',
      assessment.presence === 'invalid'
        ? 'This video file appears to be damaged or unreadable.'
        : 'Unable to prepare this video for playback.',
    );
  }

  if (assessment.presence !== 'complete') {
    throw new PlaybackError(
      'SOURCE_RESOLUTION_FAILED',
      'Unable to prepare this video for playback.',
    );
  }

  const uri = assessment.localUri;

  try {
    deps.assertManagedPath(uri, mediaId);
  } catch {
    throw new PlaybackError(
      'SOURCE_RESOLUTION_FAILED',
      'Unable to prepare this video for playback.',
    );
  }

  const verified = deps.verifyFile(uri, expectedBytesFromRecord(record), {
    downloadId: mediaId,
  });

  if (!verified.ok) {
    if (verified.reason === 'missing') {
      deps.invalidateAvailability(mediaId);
      try {
        await deps.reconcileAvailability([mediaId]);
      } catch {
        // ignore
      }
      throw new PlaybackError(
        'FILE_UNAVAILABLE',
        'File is no longer available.',
      );
    }
    throw new PlaybackError(
      'CORRUPT_MEDIA',
      'This video file appears to be damaged or unreadable.',
    );
  }

  const enrichedTitle = deps.getDisplayTitle?.(mediaId) ?? null;
  const displayName =
    deps.resolveDisplayName(enrichedTitle, record.fileName) ??
    record.fileName ??
    'Video';

  const persistedMime = deps.getMimeType?.(mediaId) ?? null;
  const mimeType = deps.normalizeMimeType(persistedMime, record.fileName);
  const resolvedUri = deps.resolveFileUri?.(uri) ?? uri;

  return {
    mediaId,
    uri: resolvedUri,
    displayName,
    mimeType,
  };
}
