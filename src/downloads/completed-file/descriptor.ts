/**
 * Phase 7A — normalize a completed-file descriptor from proven inputs.
 */

import { resolveCompletedContainer, resolveCompletedMimeType } from './extension';
import { resolveCompletedFileName } from './naming';
import { sanitizeCompletedFileName } from './sanitize';
import type {
  CompletedFileDescriptor,
  ResolveCompletedDescriptorInput,
} from './types';

function normalizeHost(value: string | null | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }
  return value.trim().toLowerCase().replace(/^www\./, '').slice(0, 253);
}

function hostFromUrl(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl?.trim()) {
    return null;
  }
  try {
    return normalizeHost(new URL(sourceUrl.trim()).hostname);
  } catch {
    return null;
  }
}

function normalizeByteSize(value: number | string | null | undefined): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return String(Math.trunc(value));
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

function normalizeIso(value: string | null | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function safeDisplayTitle(
  title: string | null | undefined,
  fileName: string,
  platform: string | null | undefined,
): string {
  const trimmed = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : '';
  if (trimmed) {
    return trimmed.slice(0, 255);
  }
  const plat = (platform ?? '').toUpperCase();
  if (plat.includes('TIKTOK')) {
    return 'TikTok Video';
  }
  if (plat.includes('INSTAGRAM')) {
    return 'Instagram Reel';
  }
  const stem = fileName.replace(/\.[a-z0-9]+$/i, '');
  if (stem && stem.toLowerCase() !== 'video' && stem.toLowerCase() !== 'download') {
    return stem.slice(0, 255);
  }
  return 'Download';
}

function looksSecret(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const lower = value.toLowerCase();
  return (
    lower.includes('cookie') ||
    lower.includes('authorization') ||
    lower.includes('bearer ') ||
    lower.includes('otp') ||
    lower.includes('password')
  );
}

/**
 * Build a completed-file descriptor.
 *
 * Returns null when status is not COMPLETED or Phase 1 validation has not
 * succeeded (when validationSucceeded is explicitly false).
 * Legacy COMPLETED rows may omit validationSucceeded — treated as eligible.
 */
export function resolveCompletedDescriptor(
  input: ResolveCompletedDescriptorInput,
): CompletedFileDescriptor | null {
  const status = typeof input.status === 'string' ? input.status.trim().toUpperCase() : '';
  if (status && status !== 'COMPLETED') {
    return null;
  }

  if (input.validationSucceeded === false) {
    return null;
  }

  const downloadId = input.downloadId?.trim();
  if (!downloadId) {
    return null;
  }

  const fileName = resolveCompletedFileName({
    downloadId,
    currentFileName: input.fileName,
    displayTitle: input.displayTitle,
    platform: input.platform,
    sourceUrl: input.sourceUrl,
    sourceHost: input.sourceHost,
    qualityLabel: input.qualityLabel,
    completedAt: input.completedAt,
    evidence: input.evidence,
    preserveExistingBaseName: input.preserveExistingBaseName ?? true,
  });

  const safeName = sanitizeCompletedFileName(fileName);
  const mimeType = resolveCompletedMimeType(input.evidence, safeName);
  const container = resolveCompletedContainer(input.evidence, safeName);
  const physicalFilePresent = input.physicalFilePresent === true;
  const fileSize = physicalFilePresent
    ? normalizeByteSize(input.fileSizeBytes)
    : normalizeByteSize(input.fileSizeBytes);

  const mediaIdentity =
    typeof input.mediaIdentity === 'string' &&
    input.mediaIdentity.trim() &&
    !looksSecret(input.mediaIdentity)
      ? input.mediaIdentity.trim().slice(0, 256)
      : null;

  const thumbnailUri =
    typeof input.thumbnailUri === 'string' &&
    /^https?:\/\//i.test(input.thumbnailUri.trim()) &&
    !looksSecret(input.thumbnailUri)
      ? input.thumbnailUri.trim()
      : null;

  const qualityLabel =
    typeof input.qualityLabel === 'string' && input.qualityLabel.trim()
      ? input.qualityLabel.trim().slice(0, 64)
      : null;

  return {
    downloadId,
    fileName: safeName,
    canonicalPath: input.canonicalPath?.trim() || null,
    mimeType,
    container,
    fileSize,
    completedAt: normalizeIso(input.completedAt),
    displayTitle: safeDisplayTitle(input.displayTitle, safeName, input.platform),
    sourceHost: normalizeHost(input.sourceHost) ?? hostFromUrl(input.sourceUrl),
    mediaIdentity,
    thumbnailUri,
    qualityLabel,
    physicalFilePresent,
  };
}

/**
 * Legacy-safe descriptor hydration when mime/container fields are missing.
 * Never renames physical files; never fabricates size/quality/thumbnail.
 */
export function resolveLegacyCompletedDescriptor(
  input: ResolveCompletedDescriptorInput,
): CompletedFileDescriptor | null {
  return resolveCompletedDescriptor({
    ...input,
    preserveExistingBaseName: true,
    validationSucceeded: input.validationSucceeded ?? true,
  });
}
