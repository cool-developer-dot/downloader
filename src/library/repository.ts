import type { DownloadItem } from '@/api';
import {
  assessLocalFile,
  type LocalFileAssessment,
} from '@/downloads/engine/local-file-state';
import {
  getLocalRecord,
  listLocalRecords,
} from '@/downloads/engine/persistence';
import type {
  LocalDownloadRecord,
  TransferProgressSnapshot,
} from '@/downloads/engine/types';

import {
  assembleCanonicalItems,
  collectCandidateIds,
  type FileAssessment,
} from './assemble';
import { libraryLog } from './diagnostics';
import { isAvailabilityCacheFresh } from './availability-ttl';
import type {
  LocalAvailability,
  MediaLibraryItem,
  MediaLibraryRemoteItem,
} from './types';

export type { FileAssessment } from './assemble';
export { assembleCanonicalItems, buildCanonicalLibrary } from './assemble';

export type AssessFileFn = (input: {
  downloadId: string;
  localUri?: string | null;
  expectedBytes?: number | null;
}) => FileAssessment;

export type LibraryRepositoryDeps = {
  listLocalRecords: () => Promise<LocalDownloadRecord[]>;
  getLocalRecord: (downloadId: string) => Promise<LocalDownloadRecord | null>;
  getDownloadItems: () => DownloadItem[];
  getTransfers: () => Record<string, TransferProgressSnapshot>;
  getFavoriteSourceKeys: () => Set<string>;
  /** Catalog media ids with favorite=1 (Library filter). */
  getFavoriteMediaIds?: () => Set<string>;
  assessFile: AssessFileFn;
  now?: () => number;
};

type AvailabilityCacheEntry = {
  assessment: FileAssessment;
  at: number;
};

const availabilityCache = new Map<string, AvailabilityCacheEntry>();
const playbackUriById = new Map<string, string>();

function expectedBytesFromSize(fileSize: string | null | undefined): number | null {
  if (!fileSize || !/^\d+$/.test(fileSize)) {
    return null;
  }
  try {
    const value = BigInt(fileSize);
    if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }
    return Number(value);
  } catch {
    return null;
  }
}

export function assessmentFromLocalFile(
  result: LocalFileAssessment,
): FileAssessment {
  if (result.presence === 'complete') {
    return {
      availability: 'available',
      verifiedBytes: result.size > 0 ? result.size : null,
    };
  }
  if (result.presence === 'missing' || result.presence === 'no_file') {
    return { availability: 'missing', verifiedBytes: null };
  }
  return { availability: 'unverified', verifiedBytes: null };
}

export const defaultAssessFile: AssessFileFn = (input) => {
  try {
    const assessment = assessLocalFile({
      downloadId: input.downloadId,
      localUri: input.localUri,
      expectedBytes: input.expectedBytes,
    });
    return assessmentFromLocalFile(assessment);
  } catch {
    return { availability: 'unverified', verifiedBytes: null };
  }
};

export function reconcileAvailabilityForIds(
  ids: string[],
  params: {
    downloadsById: Record<string, DownloadItem>;
    recordsById: Record<string, LocalDownloadRecord>;
    transfers: Record<string, TransferProgressSnapshot>;
    assessFile: AssessFileFn;
    nowMs: number;
    force?: boolean;
  },
): Record<string, FileAssessment> {
  const result: Record<string, FileAssessment> = {};
  let missing = 0;
  let scanned = 0;

  for (const id of ids) {
    const cached = availabilityCache.get(id);
    if (
      cached &&
      isAvailabilityCacheFresh({
        cachedAt: cached.at,
        nowMs: params.nowMs,
        force: params.force,
      })
    ) {
      result[id] = cached.assessment;
      continue;
    }

    const download = params.downloadsById[id];
    const record = params.recordsById[id];
    const transfer = params.transfers[id];
    const localUri = transfer?.localUri ?? record?.localUri ?? null;
    const expected =
      expectedBytesFromSize(download?.fileSize) ??
      expectedBytesFromSize(record?.expectedFileSize);

    scanned += 1;
    let assessment: FileAssessment;
    try {
      assessment = params.assessFile({
        downloadId: id,
        localUri,
        expectedBytes: expected,
      });
    } catch {
      assessment = { availability: 'unverified', verifiedBytes: null };
    }

    if (assessment.availability === 'missing') {
      missing += 1;
      libraryLog('library.file_missing', { downloadId: id }, 'warn');
    }

    if (assessment.availability === 'available' && localUri) {
      playbackUriById.set(id, localUri);
    } else {
      playbackUriById.delete(id);
    }

    availabilityCache.set(id, { assessment, at: params.nowMs });
    result[id] = assessment;
  }

  if (scanned > 0) {
    libraryLog('library.reconcile', {
      scanned,
      missing,
      cached: ids.length - scanned,
    });
  }

  return result;
}

export function clearLibraryAvailabilityCache(): void {
  availabilityCache.clear();
  playbackUriById.clear();
}

/**
 * Drop a single download's FS reconcile entry so the next check is fresh.
 * Call on COMPLETED before re-assessing — avoids sticky pre-finalization "missing".
 */
export function invalidateLibraryAvailability(downloadId: string): void {
  const id = downloadId.trim();
  if (!id) {
    return;
  }
  availabilityCache.delete(id);
  playbackUriById.delete(id);
}

/**
 * Playback URI stays behind the repository boundary.
 * Presentation components must not call this.
 */
export function getInternalPlaybackUri(downloadId: string): string | null {
  return playbackUriById.get(downloadId) ?? null;
}

export function hasPlayableLocalFile(downloadId: string): boolean {
  const cached = availabilityCache.get(downloadId);
  return cached?.assessment.availability === 'available';
}

const defaultDeps: LibraryRepositoryDeps = {
  listLocalRecords,
  getLocalRecord,
  getDownloadItems: () => [],
  getTransfers: () => ({}),
  getFavoriteSourceKeys: () => new Set(),
  assessFile: defaultAssessFile,
};

let activeDeps: LibraryRepositoryDeps = defaultDeps;

export function configureLibraryRepository(
  deps: Partial<LibraryRepositoryDeps>,
): void {
  activeDeps = { ...activeDeps, ...deps };
}

export function resetLibraryRepositoryDeps(): void {
  activeDeps = defaultDeps;
  clearLibraryAvailabilityCache();
}

export type LibraryLoadResult = {
  items: MediaLibraryItem[];
  availabilityById: Record<string, LocalAvailability>;
};

async function assemble(params: {
  deps: LibraryRepositoryDeps;
  forceReconcile: boolean;
}): Promise<LibraryLoadResult> {
  const { deps, forceReconcile } = params;
  const remoteById: Record<string, MediaLibraryRemoteItem> = {};
  const [records, downloads] = await Promise.all([
    deps.listLocalRecords(),
    Promise.resolve(deps.getDownloadItems()),
  ]);
  const transfers = deps.getTransfers();
  const favoriteKeys = deps.getFavoriteSourceKeys();
  const favoriteMediaIds = deps.getFavoriteMediaIds?.() ?? new Set<string>();
  const nowMs = deps.now?.() ?? Date.now();

  const downloadsById: Record<string, DownloadItem> = {};
  for (const item of downloads) {
    downloadsById[item.id] = item;
  }
  const recordsById: Record<string, LocalDownloadRecord> = {};
  for (const record of records) {
    recordsById[record.downloadId] = record;
  }

  const candidateIds = collectCandidateIds(downloads, records, transfers);
  if (Object.keys(remoteById).length > 0) {
    const known = new Set(candidateIds);
    for (const id of Object.keys(remoteById)) {
      if (!known.has(id)) {
        candidateIds.push(id);
        known.add(id);
      }
    }
  }

  const assessments = reconcileAvailabilityForIds(candidateIds, {
    downloadsById,
    recordsById,
    transfers,
    assessFile: deps.assessFile,
    nowMs,
    force: forceReconcile,
  });

  const items = assembleCanonicalItems({
    downloads,
    records,
    transfers,
    remoteById,
    favoriteKeys,
    favoriteMediaIds,
    assessments,
  });
  const availabilityById: Record<string, LocalAvailability> = {};
  for (const [id, assessment] of Object.entries(assessments)) {
    availabilityById[id] = assessment.availability;
  }

  libraryLog('library.load', {
    candidates: candidateIds.length,
    mapped: items.length,
    available: items.filter((item) => item.localAvailability === 'available')
      .length,
  });

  return {
    items,
    availabilityById,
  };
}

export async function getLibrary(options?: {
  forceReconcile?: boolean;
}): Promise<LibraryLoadResult> {
  return assemble({
    deps: activeDeps,
    forceReconcile: options?.forceReconcile === true,
  });
}

export async function getMediaById(
  downloadId: string,
): Promise<MediaLibraryItem | null> {
  const id = downloadId.trim();
  if (!id) {
    return null;
  }

  const deps = activeDeps;
  const [record, downloads] = await Promise.all([
    deps.getLocalRecord(id),
    Promise.resolve(deps.getDownloadItems()),
  ]);
  const download = downloads.find((item) => item.id === id) ?? null;
  if (!record && !download) {
    return null;
  }

  const transfers = deps.getTransfers();
  const transfer = transfers[id] ?? null;
  const favoriteKeys = deps.getFavoriteSourceKeys();
  const favoriteMediaIds = deps.getFavoriteMediaIds?.() ?? new Set<string>();
  const nowMs = deps.now?.() ?? Date.now();

  const downloadsById: Record<string, DownloadItem> = {};
  if (download) {
    downloadsById[id] = download;
  }
  const recordsById: Record<string, LocalDownloadRecord> = {};
  if (record) {
    recordsById[id] = record;
  }

  const assessments = reconcileAvailabilityForIds([id], {
    downloadsById,
    recordsById,
    transfers: transfer ? { [id]: transfer } : {},
    assessFile: deps.assessFile,
    nowMs,
  });

  const items = assembleCanonicalItems({
    downloads: download ? [download] : [],
    records: record ? [record] : [],
    transfers: transfer ? { [id]: transfer } : {},
    remoteById: {},
    favoriteKeys,
    favoriteMediaIds,
    assessments,
  });

  return items[0] ?? null;
}

export async function reconcileAvailability(
  ids?: string[],
  options?: { force?: boolean },
): Promise<Record<string, LocalAvailability>> {
  const deps = activeDeps;
  const [records, downloads] = await Promise.all([
    deps.listLocalRecords(),
    Promise.resolve(deps.getDownloadItems()),
  ]);
  const transfers = deps.getTransfers();
  const downloadsById: Record<string, DownloadItem> = {};
  for (const item of downloads) {
    downloadsById[item.id] = item;
  }
  const recordsById: Record<string, LocalDownloadRecord> = {};
  for (const record of records) {
    recordsById[record.downloadId] = record;
  }

  const targetIds =
    ids && ids.length > 0
      ? ids
      : collectCandidateIds(downloads, records, transfers);

  const assessments = reconcileAvailabilityForIds(targetIds, {
    downloadsById,
    recordsById,
    transfers,
    assessFile: deps.assessFile,
    nowMs: deps.now?.() ?? Date.now(),
    force: options?.force === true,
  });

  const availabilityById: Record<string, LocalAvailability> = {};
  for (const [id, assessment] of Object.entries(assessments)) {
    availabilityById[id] = assessment.availability;
  }
  return availabilityById;
}

export async function peekLocalRecord(
  downloadId: string,
): Promise<LocalDownloadRecord | null> {
  return activeDeps.getLocalRecord(downloadId);
}
