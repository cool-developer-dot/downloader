import { File, type DownloadPauseState } from 'expo-file-system';

import { DownloadEngineError } from './errors';
import type { RangeValidators } from './types';
import { mergeRangeValidatorsWithLength } from './source-validators';

/**
 * Android Expo DownloadTask encodes resume offsets as decimal byte strings.
 * iOS uses opaque base64 resume blobs — never reinterpret those as offsets.
 */
export function parseAndroidResumeOffset(
  resumeData: string | null | undefined,
): number | null {
  if (typeof resumeData !== 'string' || !/^\d+$/.test(resumeData.trim())) {
    return null;
  }
  const offset = Number(resumeData.trim());
  if (!Number.isFinite(offset) || offset < 0) {
    return null;
  }
  return Math.trunc(offset);
}

export function readPartialFileSize(destination: File): number {
  try {
    if (!destination.exists) {
      return 0;
    }
    const size = destination.size;
    return typeof size === 'number' && Number.isFinite(size) && size > 0
      ? Math.trunc(size)
      : 0;
  } catch {
    return 0;
  }
}

/** Drop auth/cookie headers from durable pause metadata — never persist secrets. */
function sanitizePauseHeaders(
  headers: DownloadPauseState['headers'],
): DownloadPauseState['headers'] {
  if (!headers || typeof headers !== 'object') {
    return headers;
  }
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (
      lower === 'authorization' ||
      lower === 'cookie' ||
      lower === 'set-cookie' ||
      lower === 'proxy-authorization'
    ) {
      continue;
    }
    if (typeof value === 'string') {
      next[key] = value;
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * Build durable pause state from the on-disk partial file.
 * Android native resumeData is an offset — it MUST match durable bytes, never
 * an in-memory counter ahead of the file (setLength would zero-pad / corrupt).
 */
export function buildDurablePauseState(
  sourceUrl: string,
  destination: File,
  prior?: DownloadPauseState | null,
  bytesWrittenHint = 0,
): DownloadPauseState | null {
  const fileSize = readPartialFileSize(destination);
  const priorAndroid = parseAndroidResumeOffset(prior?.resumeData);

  // Prefer opaque iOS-style resumeData when present — destination may still be
  // empty while the system holds bytes in a temp file + resume blob.
  if (prior?.resumeData && priorAndroid == null) {
    return {
      ...prior,
      url: prior.url || sourceUrl,
      fileUri: destination.uri,
      isDirectory: false,
      headers: sanitizePauseHeaders(prior.headers),
    };
  }

  if (fileSize <= 0) {
    return null;
  }

  // Android / numeric: on-disk size is the only safe resume offset.
  void bytesWrittenHint;
  void priorAndroid;

  return {
    url: sourceUrl,
    fileUri: destination.uri,
    isDirectory: false,
    headers: sanitizePauseHeaders(prior?.headers),
    resumeData: String(fileSize),
  };
}

/**
 * Before declaring PAUSED: file exists, size > 0 (when progress exists),
 * destination matches, and Android offset matches on-disk size.
 */
export function assertDurablePauseReady(
  destination: File,
  pauseState: DownloadPauseState | null,
  options?: { requireBytes?: boolean },
): void {
  const requireBytes = options?.requireBytes !== false;
  const fileSize = readPartialFileSize(destination);

  if (requireBytes && fileSize <= 0) {
    throw new DownloadEngineError(
      'PARTIAL_FILE_MISSING',
      'The partial download file is no longer available.',
    );
  }

  if (!pauseState?.resumeData) {
    throw new DownloadEngineError(
      'PAUSE_FAILED',
      'Couldn’t pause this download right now. Try again in a moment.',
    );
  }

  if (pauseState.fileUri && pauseState.fileUri !== destination.uri) {
    throw new DownloadEngineError(
      'PAUSE_FAILED',
      'Couldn’t pause this download right now. Try again in a moment.',
    );
  }

  const androidOffset = parseAndroidResumeOffset(pauseState.resumeData);
  if (androidOffset != null) {
    if (fileSize <= 0) {
      throw new DownloadEngineError(
        'PARTIAL_FILE_MISSING',
        'The partial download file is no longer available.',
      );
    }
    if (androidOffset !== fileSize) {
      throw new DownloadEngineError(
        'PAUSE_FAILED',
        'Couldn’t pause this download right now. Try again in a moment.',
      );
    }
  }
}

export function mergeRangeValidators(
  prior: RangeValidators | null | undefined,
  next: RangeValidators | null | undefined,
): RangeValidators | null {
  return mergeRangeValidatorsWithLength(prior, next);
}

/**
 * Probe whether the media source honors byte ranges before calling native resume.
 * Expo Android restarts from byte 0 when a Range request returns 200 — refuse
 * that path instead of silently wiping the partial file.
 *
 * Currently unreferenced. It also issues a bare fetch with no session headers,
 * so session-bound CDNs would reject it before range support could be observed.
 */
export async function assertSourceSupportsByteRange(
  sourceUrl: string,
  offset: number,
  signal?: AbortSignal,
): Promise<void> {
  if (offset <= 0) {
    return;
  }

  let response: Response;
  try {
    response = await fetch(sourceUrl, {
      method: 'GET',
      headers: {
        Range: `bytes=${offset}-${offset}`,
      },
      signal,
    });
  } catch {
    if (signal?.aborted) {
      throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
    }
    throw new DownloadEngineError(
      'NETWORK_ERROR',
      'Couldn’t verify resumable download support.',
    );
  }

  try {
    // Drain/cancel body so the connection does not linger.
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }

    if (response.status === 206) {
      const contentRange = response.headers.get('Content-Range');
      if (!contentRange) {
        throw new DownloadEngineError(
          'RANGE_REJECTED',
          'This media source doesn’t allow resuming a partial download.',
        );
      }
      const match = /^bytes\s+(\d+)-/i.exec(contentRange.trim());
      const start = match?.[1] != null ? Number(match[1]) : NaN;
      if (!Number.isFinite(start) || Math.trunc(start) !== Math.trunc(offset)) {
        throw new DownloadEngineError(
          'RANGE_REJECTED',
          'This media source doesn’t allow resuming a partial download.',
        );
      }
      return;
    }

    if (response.status === 416) {
      // Offset at/past EOF — caller may treat as complete; not a silent restart.
      throw new DownloadEngineError(
        'RANGE_REJECTED',
        'Unable to resume this download.',
      );
    }

    if (response.status === 200) {
      throw new DownloadEngineError(
        'RESUME_UNSUPPORTED',
        'This media source doesn’t allow resuming a partial download.',
      );
    }

    throw new DownloadEngineError(
      'RESUME_UNSUPPORTED',
      'This media source doesn’t allow resuming a partial download.',
    );
  } finally {
    // no-op — body already cancelled
  }
}
