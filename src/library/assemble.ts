import type { DownloadItem } from '@/api';
import type {
  LocalDownloadRecord,
  TransferProgressSnapshot,
} from '@/downloads/engine/types';

import { isCompletedStatus, isLibraryCandidate } from './eligibility';
import { dedupeLibraryItems, mapToMediaLibraryItem } from './mapper';
import type {
  LibraryBuildSource,
  LocalAvailability,
  MediaLibraryItem,
  MediaLibraryRemoteItem,
} from './types';

export type FileAssessment = {
  availability: LocalAvailability;
  verifiedBytes: number | null;
};

function normalizeFavoriteKey(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }
  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

function inferAssessmentFromLocalState(
  transfer?: TransferProgressSnapshot | null,
  local?: LocalDownloadRecord | null,
): FileAssessment {
  const state = transfer?.localState ?? local?.localState ?? null;
  if (state === 'complete') {
    const bytes =
      transfer?.totalBytes != null && transfer.totalBytes > 0
        ? Math.trunc(transfer.totalBytes)
        : null;
    return { availability: 'available', verifiedBytes: bytes };
  }
  if (state === 'missing' || state === 'deleted') {
    return { availability: 'missing', verifiedBytes: null };
  }
  return { availability: 'unverified', verifiedBytes: null };
}

/**
 * Prefer live transfer/record truth over a stale FS reconcile cache.
 * A sticky "missing"/"unverified" assessment must not hide a file that
 * just completed (completion race before Library re-reconciled).
 */
export function resolveFileAssessment(
  cached: FileAssessment | undefined,
  transfer?: TransferProgressSnapshot | null,
  local?: LocalDownloadRecord | null,
): FileAssessment {
  const live = inferAssessmentFromLocalState(transfer, local);

  if (live.availability === 'available') {
    return {
      availability: 'available',
      verifiedBytes: live.verifiedBytes ?? cached?.verifiedBytes ?? null,
    };
  }

  if (live.availability === 'missing') {
    return live;
  }

  if (cached) {
    return cached;
  }

  return live;
}

function isFavoriteSource(
  sourceUrl: string | null | undefined,
  favoriteKeys: Set<string>,
): boolean {
  if (!sourceUrl || favoriteKeys.size === 0) {
    return false;
  }
  const key = normalizeFavoriteKey(sourceUrl);
  return Boolean(key) && favoriteKeys.has(key);
}

function mergeSource(params: {
  downloadId: string;
  download?: DownloadItem;
  local?: LocalDownloadRecord | null;
  transfer?: TransferProgressSnapshot | null;
  remote?: MediaLibraryRemoteItem;
  favorite: boolean;
  assessment: FileAssessment;
  folderIdOverride?: string | null;
  folderNameByFolderId?: Record<string, string | null | undefined>;
}): LibraryBuildSource {
  const {
    download,
    local,
    transfer,
    remote,
    favorite,
    assessment,
    folderIdOverride,
    folderNameByFolderId,
  } = params;
  const localUri = transfer?.localUri ?? local?.localUri ?? null;
  const localState = transfer?.localState ?? local?.localState ?? null;
  const status =
    download?.status ??
    local?.remoteStatus ??
    (remote ? 'COMPLETED' : null);

  const fileSize =
    assessment.verifiedBytes != null
      ? String(assessment.verifiedBytes)
      : remote?.fileSize ?? download?.fileSize ?? local?.expectedFileSize ?? '0';

  return {
    downloadId: params.downloadId,
    status,
    title: remote?.displayName ?? download?.title ?? null,
    fileName: remote?.fileName ?? download?.fileName ?? local?.fileName ?? null,
    fileSize,
    quality: remote?.quality ?? download?.quality ?? null,
    resolution: remote?.resolution ?? download?.resolution ?? null,
    bitrate: remote?.bitrate ?? download?.bitrate ?? null,
    duration: remote?.duration ?? null,
    mimeType: remote?.mimeType ?? download?.mimeType ?? null,
    downloadedAt:
      remote?.downloadedAt ?? download?.downloadedAt ?? local?.updatedAt ?? null,
    thumbnailUrl: remote?.thumbnailUrl ?? download?.thumbnailUrl ?? null,
    sourceUrl: download?.sourceUrl ?? local?.sourceUrl ?? null,
    // Folder ID comes from the persisted optimistic assignment cache when present.
    folderId:
      folderIdOverride !== undefined
        ? folderIdOverride
        : download?.folderId ?? remote?.folderId ?? null,
    folderName:
      remote?.folderName ??
      (folderIdOverride !== undefined
        ? folderIdOverride === null
          ? 'Downloads / Unfiled'
          : folderNameByFolderId?.[folderIdOverride ?? ''] ?? null
        : download?.folderId == null
          ? 'Downloads / Unfiled'
          : folderNameByFolderId?.[download.folderId ?? ''] ?? null),
    lastPlayedAt: null,
    progressPercent: null,
    positionSeconds: null,
    completed: false,
    localUri,
    localState,
    favorite: favorite === true,
    localAvailability: assessment.availability,
    verifiedBytes: assessment.verifiedBytes,
  };
}

export function buildCanonicalLibrary(
  sources: LibraryBuildSource[],
): MediaLibraryItem[] {
  const mapped: MediaLibraryItem[] = [];
  for (const source of sources) {
    const item = mapToMediaLibraryItem(source);
    if (item) {
      mapped.push(item);
    }
  }
  return dedupeLibraryItems(mapped);
}

export function collectCandidateIds(
  downloads: DownloadItem[],
  records: LocalDownloadRecord[],
  transfers: Record<string, TransferProgressSnapshot>,
): string[] {
  const ids = new Set<string>();

  for (const item of downloads) {
    if (
      isLibraryCandidate({
        downloadId: item.id,
        status: item.status,
        fileName: item.fileName,
        localUri: transfers[item.id]?.localUri ?? null,
        localState: transfers[item.id]?.localState ?? null,
      })
    ) {
      ids.add(item.id);
    }
  }

  for (const record of records) {
    const status = record.remoteStatus;
    if (
      isCompletedStatus(status) &&
      isLibraryCandidate({
        downloadId: record.downloadId,
        status,
        fileName: record.fileName,
        localUri: record.localUri,
        localState: record.localState,
      })
    ) {
      ids.add(record.downloadId);
    }
  }

  return Array.from(ids);
}

export function assembleCanonicalItems(input: {
  downloads: DownloadItem[];
  records: LocalDownloadRecord[];
  transfers: Record<string, TransferProgressSnapshot>;
  remoteById: Record<string, MediaLibraryRemoteItem>;
  favoriteKeys: Set<string>;
  favoriteMediaIds?: Set<string>;
  assessments: Record<string, FileAssessment>;
  folderIdByMediaId?: Record<string, string | null | undefined>;
  folderNameByFolderId?: Record<string, string | null | undefined>;
}): MediaLibraryItem[] {
  const downloadsById: Record<string, DownloadItem> = {};
  for (const item of input.downloads) {
    downloadsById[item.id] = item;
  }
  const recordsById: Record<string, LocalDownloadRecord> = {};
  for (const record of input.records) {
    recordsById[record.downloadId] = record;
  }

  const candidateIds = collectCandidateIds(
    input.downloads,
    input.records,
    input.transfers,
  );
  const candidateSet = new Set(candidateIds);
  for (const id of Object.keys(input.remoteById)) {
    if (!candidateSet.has(id)) {
      candidateSet.add(id);
      candidateIds.push(id);
    }
  }

  const sources: LibraryBuildSource[] = [];
  for (const id of candidateIds) {
    const download = downloadsById[id];
    const local = recordsById[id];
    const remote = input.remoteById[id];
    const assessment = resolveFileAssessment(
      input.assessments[id],
      input.transfers[id] ?? null,
      local,
    );
    const favorite =
      (input.favoriteMediaIds?.has(id) ?? false) ||
      isFavoriteSource(
        download?.sourceUrl ?? local?.sourceUrl,
        input.favoriteKeys,
      ) ||
      remote?.favorite === true;
    sources.push(
      mergeSource({
        downloadId: id,
        download,
        local,
        transfer: input.transfers[id] ?? null,
        remote,
        favorite,
        assessment,
        folderIdOverride: input.folderIdByMediaId?.[id],
        folderNameByFolderId: input.folderNameByFolderId,
      }),
    );
  }

  return buildCanonicalLibrary(sources);
}
