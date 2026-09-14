import AsyncStorage from '@react-native-async-storage/async-storage';

import { DOWNLOAD_ENGINE } from './constants';
import type { LocalDownloadRecord, MultiRangePartState } from './types';

type RecordMap = Record<string, LocalDownloadRecord>;

let memoryCache: RecordMap | null = null;

function normalizeRecord(
  downloadId: string,
  raw: Partial<LocalDownloadRecord> | null | undefined,
): LocalDownloadRecord | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  if (typeof raw.sourceUrl !== 'string' || typeof raw.fileName !== 'string') {
    return null;
  }
  return {
    downloadId,
    sourceUrl: raw.sourceUrl,
    fileName: raw.fileName,
    expectedFileSize:
      typeof raw.expectedFileSize === 'string' ? raw.expectedFileSize : '0',
    localUri: typeof raw.localUri === 'string' ? raw.localUri : null,
    localState: raw.localState ?? 'not_started',
    bytesWritten:
      typeof raw.bytesWritten === 'number' && Number.isFinite(raw.bytesWritten)
        ? Math.max(0, Math.trunc(raw.bytesWritten))
        : 0,
    totalBytes:
      typeof raw.totalBytes === 'number' && Number.isFinite(raw.totalBytes)
        ? raw.totalBytes
        : null,
    pauseState: raw.pauseState ?? null,
    rangeValidators: normalizeRangeValidators(raw.rangeValidators),
    generation:
      typeof raw.generation === 'number' && Number.isFinite(raw.generation)
        ? Math.max(0, Math.trunc(raw.generation))
        : 0,
    errorCode: raw.errorCode ?? null,
    errorMessage: raw.errorMessage ?? null,
    remoteStatus: raw.remoteStatus ?? null,
    retryCount:
      typeof raw.retryCount === 'number' && Number.isFinite(raw.retryCount)
        ? Math.max(0, Math.trunc(raw.retryCount))
        : 0,
    maxRetries:
      typeof raw.maxRetries === 'number' && Number.isFinite(raw.maxRetries)
        ? Math.max(0, Math.trunc(raw.maxRetries))
        : DOWNLOAD_ENGINE.maxAutoRetryAttempts,
    retryEligible: raw.retryEligible !== false,
    lastAttemptAt:
      typeof raw.lastAttemptAt === 'string' ? raw.lastAttemptAt : null,
    nextRetryAt: typeof raw.nextRetryAt === 'string' ? raw.nextRetryAt : null,
    updatedAt:
      typeof raw.updatedAt === 'string'
        ? raw.updatedAt
        : new Date().toISOString(),
    hlsTransfer: normalizeHlsTransfer(raw.hlsTransfer),
    multiRange: normalizeMultiRange(raw.multiRange),
    pauseReason: normalizePauseReason(raw.pauseReason),
    requiresEphemeralSession: raw.requiresEphemeralSession === true,
  };
}

function normalizePauseReason(
  raw: unknown,
): LocalDownloadRecord['pauseReason'] {
  if (raw === 'USER' || raw === 'NETWORK_POLICY' || raw === 'SYSTEM_RECOVERY') {
    return raw;
  }
  return null;
}

function normalizeRangeValidators(
  raw: unknown,
): LocalDownloadRecord['rangeValidators'] {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const etag = typeof value.etag === 'string' ? value.etag : null;
  const lastModified =
    typeof value.lastModified === 'string' ? value.lastModified : null;
  const contentLength =
    typeof value.contentLength === 'number' &&
    Number.isFinite(value.contentLength) &&
    value.contentLength > 0
      ? Math.trunc(value.contentLength)
      : null;
  if (!etag && !lastModified && contentLength == null) {
    return null;
  }
  return { etag, lastModified, contentLength };
}

function normalizeMultiRange(
  raw: unknown,
): LocalDownloadRecord['multiRange'] {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const contentLength =
    typeof value.contentLength === 'number' &&
    Number.isFinite(value.contentLength) &&
    value.contentLength > 0
      ? Math.trunc(value.contentLength)
      : 0;
  const workerCount =
    typeof value.workerCount === 'number' && Number.isFinite(value.workerCount)
      ? Math.max(1, Math.trunc(value.workerCount))
      : 0;
  if (contentLength <= 0 || workerCount <= 0 || !Array.isArray(value.parts)) {
    return null;
  }
  const parts = value.parts
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const part = entry as Record<string, unknown>;
      const index =
        typeof part.index === 'number' && Number.isFinite(part.index)
          ? Math.trunc(part.index)
          : -1;
      const rangeStart =
        typeof part.rangeStart === 'number' && Number.isFinite(part.rangeStart)
          ? Math.trunc(part.rangeStart)
          : -1;
      const rangeEnd =
        typeof part.rangeEnd === 'number' && Number.isFinite(part.rangeEnd)
          ? Math.trunc(part.rangeEnd)
          : -1;
      if (index < 0 || rangeStart < 0 || rangeEnd < rangeStart) {
        return null;
      }
      const statusRaw = typeof part.status === 'string' ? part.status : 'PENDING';
      const status: MultiRangePartState['status'] =
        statusRaw === 'RUNNING' ||
        statusRaw === 'PAUSED' ||
        statusRaw === 'COMPLETED' ||
        statusRaw === 'FAILED' ||
        statusRaw === 'CANCELLED'
          ? statusRaw
          : 'PENDING';
      return {
        index,
        rangeStart,
        rangeEnd,
        downloadedBytes:
          typeof part.downloadedBytes === 'number' &&
          Number.isFinite(part.downloadedBytes)
            ? Math.max(0, Math.trunc(part.downloadedBytes))
            : 0,
        status,
        retryCount:
          typeof part.retryCount === 'number' && Number.isFinite(part.retryCount)
            ? Math.max(0, Math.trunc(part.retryCount))
            : 0,
        lastFailureReason:
          typeof part.lastFailureReason === 'string'
            ? part.lastFailureReason
            : null,
      };
    })
    .filter((part): part is NonNullable<typeof part> => part != null);

  if (parts.length === 0) {
    return null;
  }

  return {
    contentLength,
    workerCount,
    sourceValidators: normalizeRangeValidators(value.sourceValidators),
    parts,
    failedPart:
      typeof value.failedPart === 'number' && Number.isFinite(value.failedPart)
        ? Math.trunc(value.failedPart)
        : null,
  };
}

function normalizeHlsTransfer(raw: unknown): LocalDownloadRecord['hlsTransfer'] {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const totalSegments =
    typeof value.totalSegments === 'number' && Number.isFinite(value.totalSegments)
      ? Math.max(0, Math.trunc(value.totalSegments))
      : 0;
  const completedSegments =
    typeof value.completedSegments === 'number' &&
    Number.isFinite(value.completedSegments)
      ? Math.max(0, Math.trunc(value.completedSegments))
      : 0;
  const downloadedBytes =
    typeof value.downloadedBytes === 'number' && Number.isFinite(value.downloadedBytes)
      ? Math.max(0, Math.trunc(value.downloadedBytes))
      : 0;
  return {
    totalSegments,
    completedSegments,
    currentSegment:
      typeof value.currentSegment === 'number' && Number.isFinite(value.currentSegment)
        ? Math.trunc(value.currentSegment)
        : null,
    downloadedBytes,
    failedSegment:
      typeof value.failedSegment === 'number' && Number.isFinite(value.failedSegment)
        ? Math.trunc(value.failedSegment)
        : null,
    retryCount:
      typeof value.retryCount === 'number' && Number.isFinite(value.retryCount)
        ? Math.max(0, Math.trunc(value.retryCount))
        : 0,
    lastFailureReason:
      typeof value.lastFailureReason === 'string' ? value.lastFailureReason : null,
  };
}

async function readAll(): Promise<RecordMap> {
  if (memoryCache) {
    return memoryCache;
  }

  try {
    const raw = await AsyncStorage.getItem(DOWNLOAD_ENGINE.persistenceKey);
    if (!raw) {
      memoryCache = {};
      return memoryCache;
    }
    const parsed = JSON.parse(raw) as Record<string, Partial<LocalDownloadRecord>>;
    const normalized: RecordMap = {};
    if (parsed && typeof parsed === 'object') {
      for (const [id, value] of Object.entries(parsed)) {
        const record = normalizeRecord(id, value);
        if (record) {
          normalized[id] = record;
        }
      }
    }
    memoryCache = normalized;
    return memoryCache;
  } catch {
    memoryCache = {};
    return memoryCache;
  }
}

async function writeAll(map: RecordMap): Promise<void> {
  memoryCache = map;
  try {
    await AsyncStorage.setItem(
      DOWNLOAD_ENGINE.persistenceKey,
      JSON.stringify(map),
    );
  } catch {
    // Persistence failure must not kill transfers; in-memory remains authoritative for session.
  }
}

export async function getLocalRecord(
  downloadId: string,
): Promise<LocalDownloadRecord | null> {
  const all = await readAll();
  return all[downloadId] ?? null;
}

export async function listLocalRecords(): Promise<LocalDownloadRecord[]> {
  const all = await readAll();
  return Object.values(all);
}

export async function upsertLocalRecord(
  record: LocalDownloadRecord,
): Promise<void> {
  const all = await readAll();
  all[record.downloadId] = {
    ...record,
    updatedAt: new Date().toISOString(),
  };
  await writeAll(all);
}

export async function removeLocalRecord(downloadId: string): Promise<void> {
  const all = await readAll();
  if (!(downloadId in all)) {
    return;
  }
  delete all[downloadId];
  await writeAll(all);
}

export async function clearAllLocalRecords(): Promise<void> {
  memoryCache = {};
  try {
    await AsyncStorage.removeItem(DOWNLOAD_ENGINE.persistenceKey);
  } catch {
    // ignore
  }
}
