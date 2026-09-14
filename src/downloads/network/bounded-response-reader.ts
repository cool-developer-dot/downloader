/**
 * Bounded HTTP response body consumption — never buffers unbounded media bodies.
 * Used for manifests, probes, and prefix signature reads.
 */

import { DownloadEngineError } from '@/downloads/engine/errors';

export type BoundedReadResult = {
  bytes: Uint8Array;
  bytesConsumed: number;
  abortedAtByteLimit: boolean;
};

function mergeChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Read up to maxBytes from a Response body stream, then cancel the reader.
 */
export async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<BoundedReadResult> {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new DownloadEngineError(
      'INVALID_RESOURCE',
      'Invalid bounded read limit.',
    );
  }

  const body = response.body;
  if (!body) {
    throw new DownloadEngineError(
      'TRANSFER_INTERRUPTED',
      'Response body stream is unavailable.',
    );
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let consumed = 0;
  let abortedAtByteLimit = false;

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DownloadEngineError('CANCELLED', 'Download cancelled.');
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }

      if (consumed + value.byteLength > maxBytes) {
        const take = maxBytes - consumed;
        if (take > 0) {
          chunks.push(value.subarray(0, take));
          consumed += take;
        }
        abortedAtByteLimit = true;
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        break;
      }

      chunks.push(value);
      consumed += value.byteLength;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  return {
    bytes: mergeChunks(chunks, consumed),
    bytesConsumed: consumed,
    abortedAtByteLimit,
  };
}

/**
 * Decode bounded UTF-8 text safely across chunk boundaries.
 */
export async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<{
  text: string;
  bytesConsumed: number;
  abortedAtByteLimit: boolean;
}> {
  const { bytes, bytesConsumed, abortedAtByteLimit } = await readBoundedResponseBody(
    response,
    maxBytes,
    signal,
  );
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const text = decoder.decode(bytes);
  return { text, bytesConsumed, abortedAtByteLimit };
}

/**
 * Read a bounded prefix for signature / MIME sniffing.
 */
export async function readResponsePrefix(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<BoundedReadResult> {
  return readBoundedResponseBody(response, maxBytes, signal);
}
