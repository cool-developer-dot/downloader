/**
 * Final file validation pipeline — Phase 1E file integrity gate.
 */

import type { File } from 'expo-file-system';

import {
  commitPartialToFinalFile,
  deletePartialTransferQuiet,
  deleteRangePartQuiet,
  isPartialTransferPath,
  verifyCompletedFile,
} from './file-paths';
import { validationReasonMessage } from './http-response-validation';
import { verifyDownloadedMediaContent } from './media-validation';
import { MIN_VALID_MEDIA_BYTES } from './media-signature';
import type { DownloadEngineErrorCode } from './types';

export type FinalizeValidationInput = {
  /** In-progress transfer file (`.part`) — validated before commit. */
  file: File;
  /** Canonical final destination — commit target after validation. */
  destination: File;
  expectedBytes: number | null;
  downloadId: string;
};

export type FinalizeValidationResult =
  | {
      ok: true;
      size: number;
      finalUri: string;
      /** Structural signature kind from Phase 1 content validation. */
      signatureKind: string;
    }
  | { ok: false; code: DownloadEngineErrorCode; message: string };

/**
 * Validate downloaded bytes on the transfer partial, commit to final path,
 * then verify the committed file. Caller must ensure network writer is settled.
 */
export async function validateFinalDownloadFile(
  input: FinalizeValidationInput,
): Promise<FinalizeValidationResult> {
  const alreadyFinal =
    input.file.uri === input.destination.uri ||
    !isPartialTransferPath(input.file.uri, input.file.name);

  deleteRangePartQuiet(input.file);
  deleteRangePartQuiet(input.destination);

  const fileSize =
    typeof input.file.size === 'number' && Number.isFinite(input.file.size)
      ? Math.trunc(input.file.size)
      : 0;

  if (fileSize <= 0) {
    return {
      ok: false,
      code: 'FINAL_FILE_INVALID',
      message: 'The download was incomplete.',
    };
  }

  if (fileSize < MIN_VALID_MEDIA_BYTES) {
    return {
      ok: false,
      code: 'FINAL_FILE_INVALID',
      message: 'The downloaded file was not a valid video.',
    };
  }

  const contentCheck = await verifyDownloadedMediaContent(input.file);
  if (!contentCheck.ok) {
    return {
      ok: false,
      code: 'FINAL_FILE_INVALID',
      message: validationReasonMessage(contentCheck.reason),
    };
  }

  const signatureKind = contentCheck.kind;

  let finalUri = input.destination.uri;
  let committedSize = fileSize;

  if (!alreadyFinal) {
    const commit = commitPartialToFinalFile(input.file, input.destination);
    if (!commit.ok) {
      deletePartialTransferQuiet(input.file);
      return {
        ok: false,
        code: 'FILE_FINALIZE_FAILED',
        message: 'Unable to save the completed download.',
      };
    }
    committedSize = commit.size;
    finalUri = input.destination.uri;
  }

  let verification = verifyCompletedFile(input.destination, input.expectedBytes, {
    downloadId: input.downloadId,
  });

  if (
    !verification.ok &&
    verification.reason === 'corrupt' &&
    input.expectedBytes != null &&
    input.expectedBytes > 0 &&
    committedSize > MIN_VALID_MEDIA_BYTES
  ) {
    verification = verifyCompletedFile(input.destination, null, {
      downloadId: input.downloadId,
    });
  }

  if (!verification.ok) {
    try {
      if (input.destination.exists) {
        input.destination.delete();
      }
    } catch {
      // ignore
    }
    const code =
      input.expectedBytes != null &&
      input.expectedBytes > 0 &&
      committedSize > 0
        ? 'FINAL_SIZE_MISMATCH'
        : 'FINAL_FILE_INVALID';
    return {
      ok: false,
      code,
      message:
        code === 'FINAL_SIZE_MISMATCH'
          ? 'Download was incomplete. Retry download.'
          : verification.reason === 'missing'
            ? 'Downloaded file is missing.'
            : 'The downloaded file failed integrity checks.',
    };
  }

  return {
    ok: true,
    size: verification.size,
    finalUri,
    signatureKind,
  };
}
