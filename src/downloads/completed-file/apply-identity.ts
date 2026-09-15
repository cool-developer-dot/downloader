/**
 * Phase 7A — apply completed-file identity after Phase 1 validation.
 * Pure naming/MIME resolution + same-directory rename when extension must change.
 */

import { File } from 'expo-file-system';

import {
  assertManagedDownloadPath,
  getDownloadItemDirectory,
  verifyCompletedFile,
} from '@/downloads/engine/file-paths';
import { hardeningLog } from '@/downloads/hardening-diagnostics';

import {
  resolveCompletedDescriptor,
  type CompletedFileDescriptor,
  type CompletedValidationEvidence,
} from './index';

export type ApplyCompletedFileIdentityInput = {
  downloadId: string;
  /** Validated final file URI from Phase 1. */
  finalUri: string;
  /** Current destination basename before identity correction. */
  currentFileName: string;
  /** Actual validated byte size. */
  fileSize: number;
  displayTitle?: string | null;
  platform?: string | null;
  sourceUrl?: string | null;
  qualityLabel?: string | null;
  thumbnailUri?: string | null;
  completedAt?: string | null;
  evidence: CompletedValidationEvidence;
};

export type ApplyCompletedFileIdentityResult = {
  descriptor: CompletedFileDescriptor;
  localUri: string;
  fileName: string;
  renamed: boolean;
};

/**
 * After Phase 1 validation succeeds: resolve descriptor and correct extension
 * on disk when needed. Never renames across directories. Never invents metadata.
 */
export async function applyCompletedFileIdentity(
  input: ApplyCompletedFileIdentityInput,
): Promise<ApplyCompletedFileIdentityResult> {
  const completedAt = input.completedAt ?? new Date().toISOString();

  const provisional = resolveCompletedDescriptor({
    downloadId: input.downloadId,
    status: 'COMPLETED',
    fileName: input.currentFileName,
    canonicalPath: input.finalUri,
    displayTitle: input.displayTitle,
    platform: input.platform,
    sourceUrl: input.sourceUrl,
    qualityLabel: input.qualityLabel,
    thumbnailUri: input.thumbnailUri,
    completedAt,
    fileSizeBytes: input.fileSize,
    physicalFilePresent: true,
    validationSucceeded: true,
    evidence: input.evidence,
    // Keep useful create-time stems; only force-correct extension/MIME.
    preserveExistingBaseName: true,
  });

  if (!provisional) {
    throw new Error('Completed descriptor unavailable after validation');
  }

  let localUri = input.finalUri;
  let fileName = provisional.fileName;
  let renamed = false;

  const current = new File(input.finalUri);
  const desiredName = provisional.fileName;

  if (current.name !== desiredName) {
    try {
      const dir = getDownloadItemDirectory(input.downloadId);
      const destination = new File(dir, desiredName);
      assertManagedDownloadPath(destination.uri, input.downloadId);

      if (destination.uri !== current.uri) {
        if (destination.exists) {
          // Isolated per-downloadId directory — unexpected collision; keep current.
          hardeningLog('completed_identity_rename_collision', {
            downloadId: input.downloadId,
            fileName: desiredName,
          });
        } else if (current.exists) {
          await current.move(destination);
          if (destination.exists) {
            localUri = destination.uri;
            fileName = desiredName;
            renamed = true;
          }
        }
      }
    } catch (error) {
      hardeningLog('completed_identity_rename_failed', {
        downloadId: input.downloadId,
        reason: 'rename_failed',
      });
      // Keep validated path — never leave catalog pointing at a missing rename target.
      // File.move may mutate this File's URI before a later check throws.
      localUri = current.exists ? current.uri : input.finalUri;
      fileName = current.name || input.currentFileName;
      renamed = false;
    }
  }

  const physical = new File(localUri);
  assertManagedDownloadPath(physical.uri, input.downloadId);
  if (!verifyCompletedFile(physical, input.fileSize, { downloadId: input.downloadId }).ok) {
    throw new Error('Completed physical identity unavailable');
  }
  fileName = physical.name;

  const descriptor =
    resolveCompletedDescriptor({
      downloadId: input.downloadId,
      status: 'COMPLETED',
      fileName,
      canonicalPath: localUri,
      displayTitle: input.displayTitle,
      platform: input.platform,
      sourceUrl: input.sourceUrl,
      qualityLabel: input.qualityLabel,
      thumbnailUri: input.thumbnailUri,
      completedAt,
      fileSizeBytes: input.fileSize,
      physicalFilePresent: true,
      validationSucceeded: true,
      evidence: input.evidence,
      preserveExistingBaseName: true,
    }) ?? provisional;

  return {
    descriptor: {
      ...descriptor,
      fileName,
      canonicalPath: localUri,
      fileSize: String(input.fileSize),
      completedAt,
      physicalFilePresent: true,
    },
    localUri,
    fileName,
    renamed,
  };
}
