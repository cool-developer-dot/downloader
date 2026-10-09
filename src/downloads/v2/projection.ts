import type {
  DownloadErrorCode,
  DownloadProgressEvent,
  DownloadRecord,
  DownloadState,
  LibraryItem,
  SiteId,
} from '@modules/vidorax-media/src/VidoraMedia.types';

import type { DownloadItem, DownloadStatus, DownloadWorkerState } from '@/api/types';
import type { TransferProgressSnapshot } from '@/downloads/engine/types';
import type { DownloadExecutionState } from '@/downloads/execution/download-execution-state';

/** One v2 download as the existing Downloads/Library UI renders it: the catalog-shaped row plus its live transfer. */
export type V2DownloadEntry = {
  /** True for a video that exists only as a library item: it belongs in Player, never in the Downloads list. */
  libraryOnly?: boolean;
  item: DownloadItem;
  transfer: TransferProgressSnapshot;
};

type StateProjection = {
  status: DownloadStatus;
  workerState: DownloadWorkerState;
  executionState: DownloadExecutionState;
  localState: TransferProgressSnapshot['localState'];
};

const STATES: Record<DownloadState, StateProjection> = {
  queued: { status: 'QUEUED', workerState: 'WAITING', executionState: 'QUEUED', localState: 'not_started' },
  probing: { status: 'QUEUED', workerState: 'STARTING', executionState: 'PREPARING', localState: 'not_started' },
  waiting_network: { status: 'QUEUED', workerState: 'WAITING', executionState: 'QUEUED', localState: 'not_started' },
  waiting_retry: { status: 'QUEUED', workerState: 'RETRY_WAIT', executionState: 'RETRYING', localState: 'not_started' },
  downloading: { status: 'DOWNLOADING', workerState: 'TRANSFERRING', executionState: 'DOWNLOADING', localState: 'transferring' },
  // Verify → finalize → library insert: the existing "Finalizing" presentation.
  processing: { status: 'DOWNLOADING', workerState: 'VERIFYING', executionState: 'FINALIZING', localState: 'finalizing' },
  paused: { status: 'PAUSED', workerState: 'PAUSED', executionState: 'PAUSED', localState: 'paused' },
  completed: { status: 'COMPLETED', workerState: 'COMPLETED', executionState: 'COMPLETED', localState: 'complete' },
  failed: { status: 'FAILED', workerState: 'FAILED', executionState: 'FAILED', localState: 'failed' },
  cancelled: { status: 'CANCELLED', workerState: 'CANCELLED', executionState: 'CANCELLED', localState: 'not_started' },
};

const FAILURE_MESSAGES: Record<DownloadErrorCode, string> = {
  NETWORK: 'Network error. Check your connection and retry.',
  HTTP_403: 'The site refused this download. Reopen the page and try again.',
  HTTP_404: 'The video is no longer available at this link.',
  HTTP_ERROR: 'The server returned an error. Retry later.',
  SOURCE_EXPIRED: 'The download link expired. Reopen the page and download again.',
  DRM_PROTECTED: 'This video is protected and can’t be downloaded.',
  LIVE_UNSUPPORTED: 'Live streams can’t be downloaded.',
  UNSUPPORTED_FORMAT: 'This video format isn’t supported for download.',
  NOT_MEDIA: 'The link didn’t return a video. Reopen the page and try again.',
  PROCESSING_FAILED: 'The downloaded file failed verification.',
  NO_SPACE: 'Not enough storage.',
  STORAGE_ERROR: 'The file couldn’t be saved to storage.',
  DUPLICATE: 'Video already downloaded',
  UNKNOWN: 'The download failed.',
  VIDEO_TRACK_MISSING: 'The video file has no picture, so it can’t be saved.',
  AUDIO_TRACK_MISSING: 'The audio track of this video is missing.',
  TRACK_MISMATCH: 'The audio doesn’t belong to this video. Reopen the page and download again.',
  SEGMENT_FAILED: 'Part of the stream couldn’t be downloaded. Retry later.',
  MUX_FAILED: 'Couldn’t merge the audio and video. Retry to try again.',
  TRANSCODE_FAILED: 'Couldn’t convert this video on this device.',
  INVALID_MEDIA: 'The finished file didn’t play back correctly.',
};

/** Existing catalog platform labels (formatPlatform title-cases them); generic websites stay OTHER. */
function platformLabel(site: SiteId): string {
  return site === 'web' ? 'OTHER' : site.toUpperCase();
}

function iso(ms: number | null | undefined): string {
  return new Date(typeof ms === 'number' && Number.isFinite(ms) ? ms : 0).toISOString();
}

function percent(bytes: number, total: number | null): number {
  if (total == null || total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.floor((bytes / total) * 100)));
}

export function v2FailureMessage(code: DownloadErrorCode | null): string {
  return (code && FAILURE_MESSAGES[code]) || FAILURE_MESSAGES.UNKNOWN;
}

/**
 * The quality a finished file really has, from its verified dimensions: the short side, so a vertical 720x1280
 * video reads "720p" like its landscape twin. Null when the file reported no size. A completed row shows this, not
 * the label the offer carried ("Original Quality", or a ceiling the server did not reach).
 */
export function fileQualityLabel(file: Pick<LibraryItem, 'width' | 'height'>): string | null {
  const { width, height } = file;
  if (!width || !height || width <= 0 || height <= 0) {
    return null;
  }
  return `${Math.min(width, height)}p`;
}

/**
 * Projects a v2 record (plus its library item once completed, and the latest progress event) into the row the
 * existing UI renders. The media source URL is never carried: rows keep the page URL, so no signed link lands in
 * JavaScript state; the library file is the only playable URI and exists only after COMPLETED.
 */
export function projectV2Download(
  record: DownloadRecord,
  extras: { library?: LibraryItem | null; progress?: DownloadProgressEvent | null } = {},
): V2DownloadEntry {
  const projection = STATES[record.state] ?? STATES.failed;
  const library = record.state === 'completed' ? (extras.library ?? null) : null;
  const progress = record.state === 'downloading' && extras.progress?.id === record.id ? extras.progress : null;
  const bytes = progress ? Math.max(progress.bytesDone, record.bytesDone) : record.bytesDone;
  const total = library?.sizeBytes ?? progress?.totalBytes ?? record.totalBytes;
  const completed = record.state === 'completed';
  const failed = record.state === 'failed';

  const item: DownloadItem = {
    id: record.id,
    userId: '',
    title: library?.title || record.title,
    sourceUrl: library?.pageUrl ?? record.pageUrl ?? '',
    platform: platformLabel(library?.site ?? record.site),
    thumbnailUrl: library?.thumbnailUri ?? record.thumbnailUrl ?? '',
    fileName: library?.fileName ?? '',
    folderId: null,
    fileSize: String(Math.max(0, Math.trunc(total ?? 0))),
    status: projection.status,
    progress: completed ? 100 : percent(bytes, total),
    quality: (library && fileQualityLabel(library)) || record.qualityLabel,
    resolution: library?.width && library.height ? `${library.width}x${library.height}` : null,
    bitrate: null,
    mimeType: library?.mimeType ?? null,
    container: library && library.container !== 'unknown' ? library.container : null,
    retryCount: record.attempts,
    workerState: projection.workerState,
    errorCode: failed ? record.errorCode ?? 'UNKNOWN' : null,
    errorMessage: failed ? v2FailureMessage(record.errorCode) : null,
    downloadedAt: completed ? iso(library?.completedAt ?? record.updatedAt) : null,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
    // Only a finished video in the library has a favorite of its own.
    ...(library ? { favorite: library.favorite } : {}),
  };

  const transfer: TransferProgressSnapshot = {
    downloadId: record.id,
    bytesWritten: completed ? (library?.sizeBytes ?? bytes) : bytes,
    totalBytes: total ?? null,
    progress: item.progress,
    bytesPerSecond: progress ? progress.speedBps : null,
    etaSeconds: progress ? progress.etaSeconds : null,
    // A completed record without its library item is not playable yet: never claim a file.
    localUri: library?.fileUri ?? null,
    localState: completed && !library ? 'finalizing' : projection.localState,
    workerState: projection.workerState,
    executionState: projection.executionState,
    errorCode: null,
    errorMessage: item.errorMessage,
  };

  return { item, transfer };
}

/** A library item with no recent download record (older completion or v1 file import) is a completed row. */
/** A video that exists only in the library — its download record is gone (removed, or older than a day). */
export function projectV2LibraryItem(library: LibraryItem): V2DownloadEntry {
  return {
    libraryOnly: true,
    ...projectV2Download(
    {
      id: library.id,
      state: 'completed',
      title: library.title,
      site: library.site,
      kind: 'progressive',
      pageUrl: library.pageUrl,
      thumbnailUrl: library.thumbnailUri,
      qualityLabel: fileQualityLabel(library),
      bytesDone: library.sizeBytes,
      totalBytes: library.sizeBytes,
      errorCode: null,
      errorMessage: null,
      attempts: 0,
      libraryItemId: library.id,
      createdAt: library.createdAt,
      updatedAt: library.completedAt,
    },
      { library },
    ),
  };
}

/** Progress events only move an active download forward; they never change its state. */
export function applyV2Progress(
  entry: V2DownloadEntry,
  event: DownloadProgressEvent,
): V2DownloadEntry | null {
  if (entry.item.id !== event.id || entry.item.status !== 'DOWNLOADING') {
    return null;
  }
  // Merging / converting after the bytes are in: the row says which, the byte counts stay final.
  if (event.phase === 'processing') {
    const stage = event.stage ?? null;
    if (entry.transfer.executionState !== 'FINALIZING' || entry.transfer.processingStage === stage) {
      return null;
    }
    return { item: entry.item, transfer: { ...entry.transfer, processingStage: stage } };
  }
  if (entry.transfer.executionState !== 'DOWNLOADING') {
    return null;
  }
  const total = event.totalBytes ?? entry.transfer.totalBytes;
  const bytes = Math.max(entry.transfer.bytesWritten, event.bytesDone);
  const progress = Math.max(entry.item.progress, percent(bytes, total));
  return {
    item: {
      ...entry.item,
      progress,
      fileSize: total != null && total > 0 ? String(Math.trunc(total)) : entry.item.fileSize,
    },
    transfer: {
      ...entry.transfer,
      bytesWritten: bytes,
      totalBytes: total,
      progress,
      bytesPerSecond: event.speedBps,
      etaSeconds: event.etaSeconds,
    },
  };
}
