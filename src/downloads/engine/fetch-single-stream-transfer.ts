/**
 * Authenticated single-stream progressive download via expo/fetch.
 * Used for social CDNs where native DownloadTask may not honor session headers.
 */

import { fetch } from 'expo/fetch';
import { File, FileMode } from 'expo-file-system';

import { MIN_VALID_MEDIA_BYTES, sniffMediaSignature } from './media-signature';
import { assertValidMediaHttpResponse } from './http-response-validation';
import { classifyTransferError, DownloadEngineError } from './errors';
import { USER_PAUSE_ABORT_MESSAGE } from './pause-ack';
import { isSafeHttpUrl } from './resource-guard';
import { logSocialDownload, logSocialDownloadResponse } from './social-download-diagnostics.service';
import {
  logTrafficRequest,
  sanitizeAuditUrl,
} from './audit-diagnostics.service';
import { StallWatchdog } from './stall-watchdog';
import {
  createTimeoutAbortSignal,
  TRANSFER_TIMEOUTS,
} from './transfer-timeouts';

const WRITE_CHUNK = 256 * 1024;
const PROGRESS_MIN_INTERVAL_MS = 200;
const SIGNATURE_CHECK_BYTES = 512;

export type FetchSingleStreamProgress = {
  bytesWritten: number;
  totalBytes: number | null;
};

export type FetchSingleStreamOptions = {
  sourceUrl: string;
  destination: File;
  signal: AbortSignal;
  headers?: Record<string, string> | null;
  knownTotalBytes?: number | null;
  shouldPause: () => boolean;
  onProgress: (progress: FetchSingleStreamProgress) => void;
  stallWatchdog?: StallWatchdog | null;
};

function deleteQuiet(file: File): void {
  try {
    if (file.exists) {
      file.delete();
    }
  } catch {
    // ignore
  }
}

async function streamResponseToFile(
  response: Response,
  destination: File,
  signal: AbortSignal,
  shouldPause: () => boolean,
  knownTotalBytes: number | null,
  onProgress: (written: number) => void,
  stallWatchdog?: StallWatchdog | null,
): Promise<number> {
  deleteQuiet(destination);
  const sink = destination.open(FileMode.WriteOnly);
  let written = 0;
  let prefix = new Uint8Array(0);

  const validatePrefix = (): void => {
    if (prefix.byteLength < 12) {
      return;
    }
    const head = prefix.subarray(0, Math.min(SIGNATURE_CHECK_BYTES, prefix.byteLength));
    const sig = sniffMediaSignature(head);
    logSocialDownload('signature', response.url, {
      ok: sig.ok,
      kind: sig.kind ?? null,
      reason: sig.reason ?? null,
    });
    if (!sig.ok) {
      throw new DownloadEngineError(
        'FINAL_FILE_INVALID',
        sig.kind === 'html'
          ? 'The source returned a webpage instead of the video.'
          : sig.kind === 'json'
            ? 'Downloaded response was not valid media.'
            : 'The downloaded file was not a valid video.',
      );
    }
  };

  try {
    const body = response.body;
    if (!body) {
      throw new DownloadEngineError(
        'TRANSFER_INTERRUPTED',
        'Response body stream is unavailable.',
      );
    }

    const reader = body.getReader();
    try {
      while (true) {
        if (shouldPause()) {
          throw new DownloadEngineError('CANCELLED', USER_PAUSE_ABORT_MESSAGE);
        }
        if (signal.aborted) {
          throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
        }

        stallWatchdog?.assertHealthy();

        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (!value || value.byteLength === 0) {
          continue;
        }

        if (prefix.byteLength < SIGNATURE_CHECK_BYTES) {
          const combined = new Uint8Array(prefix.byteLength + value.byteLength);
          combined.set(prefix, 0);
          combined.set(value, prefix.byteLength);
          prefix = combined.subarray(0, Math.min(SIGNATURE_CHECK_BYTES, combined.byteLength));
          if (prefix.byteLength >= 12) {
            validatePrefix();
          }
        }

        let offset = 0;
        while (offset < value.byteLength) {
          if (shouldPause()) {
            throw new DownloadEngineError('CANCELLED', USER_PAUSE_ABORT_MESSAGE);
          }
          if (signal.aborted) {
            throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
          }
          const end = Math.min(offset + WRITE_CHUNK, value.byteLength);
          sink.writeBytes(value.subarray(offset, end));
          written += end - offset;
          offset = end;
          onProgress(written);
          stallWatchdog?.noteBytes(written);
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
  } finally {
    try {
      sink.close();
    } catch {
      // ignore
    }
  }

  if (written < MIN_VALID_MEDIA_BYTES) {
    throw new DownloadEngineError(
      'FINAL_FILE_INVALID',
      'The download was incomplete.',
    );
  }

  if (prefix.byteLength >= 12) {
    validatePrefix();
  } else {
    const prefixReader = destination.open(FileMode.ReadOnly);
    try {
      const chunk = prefixReader.readBytes(SIGNATURE_CHECK_BYTES);
      const sig = sniffMediaSignature(new Uint8Array(chunk ?? []));
      logSocialDownload('signature', response.url, {
        ok: sig.ok,
        kind: sig.kind ?? null,
        reason: sig.reason ?? null,
      });
      if (!sig.ok) {
        throw new DownloadEngineError(
          'FINAL_FILE_INVALID',
          sig.kind === 'html'
            ? 'The source returned a webpage instead of the video.'
            : 'The downloaded file was not a valid video.',
        );
      }
    } finally {
      prefixReader.close();
    }
  }

  logSocialDownload('bytes', response.url, {
    actualBytes: written,
    expectedBytes: knownTotalBytes,
  });

  return written;
}

/**
 * Download full object with session headers and HTTP/content guards.
 */
export async function fetchSingleStreamTransfer(
  options: FetchSingleStreamOptions,
): Promise<File> {
  const {
    sourceUrl,
    destination,
    signal,
    headers,
    knownTotalBytes,
    shouldPause,
    onProgress,
    stallWatchdog: externalWatchdog,
  } = options;

  if (!isSafeHttpUrl(sourceUrl)) {
    throw new DownloadEngineError('INVALID_RESOURCE', 'Invalid download URL.');
  }

  if (shouldPause()) {
    throw new DownloadEngineError('CANCELLED', USER_PAUSE_ABORT_MESSAGE);
  }
  if (signal.aborted) {
    throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
  }

  const requestHeaders: Record<string, string> =
    headers && Object.keys(headers).length > 0
      ? { ...headers }
      : { Accept: '*/*' };

  logSocialDownload('request', sourceUrl, {
    hasReferer: Boolean(requestHeaders.Referer),
    hasCookie: Boolean(requestHeaders.Cookie),
    hasUserAgent: Boolean(requestHeaders['User-Agent']),
    hasOrigin: Boolean(requestHeaders.Origin),
    rangeRequested: false,
  });

  let response: Response;
  const connectTimeout = createTimeoutAbortSignal(
    TRANSFER_TIMEOUTS.connectTimeoutMs,
    signal,
  );
  try {
    response = await fetch(sourceUrl, {
      method: 'GET',
      headers: requestHeaders,
      signal: connectTimeout.signal,
    });
  } catch (error) {
    if (shouldPause()) {
      throw new DownloadEngineError('CANCELLED', USER_PAUSE_ABORT_MESSAGE);
    }
    if (signal.aborted) {
      throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
    }
    if (connectTimeout.signal.aborted && !signal.aborted) {
      throw new DownloadEngineError(
        'FIRST_BYTE_TIMEOUT',
        'Download could not start. Retrying…',
      );
    }
    throw classifyTransferError(error);
  } finally {
    connectTimeout.cleanup();
  }

  const finalUrl = response.url || sourceUrl;
  if (!isSafeHttpUrl(finalUrl)) {
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    throw new DownloadEngineError(
      'INVALID_RESOURCE',
      'Download redirect failed security checks.',
    );
  }

  if (finalUrl !== sourceUrl) {
    logSocialDownload('redirect', sourceUrl, {
      finalHostname: finalUrl ? new URL(finalUrl).hostname : null,
    });
  }

  logSocialDownloadResponse(sourceUrl, response);

  try {
    assertValidMediaHttpResponse(response);
  } catch (error) {
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    logSocialDownload('failure', sourceUrl, {
      reason: error instanceof Error ? error.message : 'http_guard',
    });
    throw error;
  }

  const contentLengthHeader = response.headers.get('Content-Length');
  const parsedLength =
    contentLengthHeader && /^\d+$/.test(contentLengthHeader)
      ? Number(contentLengthHeader)
      : null;
  {
    const sanitized = sanitizeAuditUrl(finalUrl);
    logTrafficRequest({
      trafficClass: 'download_transfer',
      method: 'GET',
      host: sanitized.host,
      pathPattern: sanitized.pathPattern,
      responseStatus: response.status,
      contentType: response.headers.get('Content-Type')?.split(';')[0] ?? null,
      contentLength: parsedLength,
    });
  }
  const totalBytes =
    parsedLength && parsedLength > 0
      ? parsedLength
      : knownTotalBytes && knownTotalBytes > 0
        ? knownTotalBytes
        : null;

  let lastProgressAt = 0;
  const stallWatchdog = externalWatchdog ?? new StallWatchdog({ shouldPause });
  if (!externalWatchdog) {
    stallWatchdog.startFirstBytePhase({
      timeoutMs: TRANSFER_TIMEOUTS.firstByteTimeoutMs,
    });
  } else {
    externalWatchdog.assertHealthy();
  }

  const emitProgress = (written: number, force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < PROGRESS_MIN_INTERVAL_MS) {
      return;
    }
    lastProgressAt = now;
    onProgress({
      bytesWritten: written,
      // Never fabricate total from written bytes — causes fake 100% on error bodies.
      totalBytes: totalBytes,
    });
  };

  emitProgress(0, true);

  try {
    await streamResponseToFile(
      response,
      destination,
      signal,
      shouldPause,
      totalBytes,
      (written) => emitProgress(written, false),
      stallWatchdog,
    );
  } catch (error) {
    // USER_PAUSE must preserve durable .part bytes. Deleting here caused
    // RESUME_STATE_MISSING with actualPartialSize=0 after a successful Pause.
    const userPause =
      shouldPause() ||
      (error instanceof DownloadEngineError &&
        error.code === 'CANCELLED' &&
        (error.message === USER_PAUSE_ABORT_MESSAGE ||
          error.message.toLowerCase().includes('paused')));
    if (!userPause) {
      deleteQuiet(destination);
    }
    if (error instanceof DownloadEngineError) {
      logSocialDownload('failure', sourceUrl, { reason: error.code });
      throw error;
    }
    throw classifyTransferError(error);
  } finally {
    if (!externalWatchdog) {
      stallWatchdog.stop();
    }
  }

  logSocialDownload('commit', sourceUrl, { ok: true });
  return destination;
}
