/**
 * Phase 7A — deterministic completed filename resolution.
 * Display title and physical filename remain separate concerns.
 */

import { isHashLikeTitle } from '@/downloads/quality/download-metadata';

import {
  resolveCompletedContainer,
  resolveCompletedExtension,
} from './extension';
import {
  completedFileExtension,
  completedFileStem,
  joinCompletedFileName,
  sanitizeCompletedFileName,
} from './sanitize';
import type { CompletedValidationEvidence } from './types';

function formatDateStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shortDownloadId(downloadId: string): string {
  const cleaned = downloadId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return cleaned.slice(0, 6) || 'file';
}

function platformSlug(platform: string | null | undefined): string | null {
  const value = (platform ?? '').trim().toUpperCase();
  if (!value) {
    return null;
  }
  if (value.includes('TIKTOK')) {
    return 'tiktok_video';
  }
  if (value.includes('INSTAGRAM')) {
    return 'instagram_reel';
  }
  if (value.includes('YOUTUBE')) {
    return 'youtube_video';
  }
  return null;
}

function isGenericStem(stem: string): boolean {
  const normalized = stem.trim().toLowerCase();
  return (
    !normalized ||
    normalized === 'download' ||
    normalized === 'video' ||
    normalized === 'download.bin' ||
    normalized === 'vidorax_video' ||
    /^vidorax_(tiktok|instagram|video)_\d{8}_\d{4}$/i.test(normalized)
  );
}

function hostSlug(host: string | null | undefined): string | null {
  if (!host?.trim()) {
    return null;
  }
  const cleaned = host
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/[^a-z0-9.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+|\.+$/g, '');
  if (!cleaned || cleaned.includes('..')) {
    return null;
  }
  // Prefer registrable-ish label, not deep CDN noise when overly long.
  const parts = cleaned.split('.').filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}_${parts[parts.length - 1]}`.slice(0, 40);
  }
  return cleaned.slice(0, 40);
}

function sourceHostFromUrl(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl?.trim()) {
    return null;
  }
  try {
    return new URL(sourceUrl.trim()).hostname || null;
  } catch {
    return null;
  }
}

function titleStem(title: string | null | undefined): string | null {
  if (!title?.trim()) {
    return null;
  }
  if (isHashLikeTitle(title)) {
    return null;
  }
  // Titles that look like auth headers are never filename material.
  if (/cookie\s*[:=]|authorization\s*[:=]|bearer\s+\S+/i.test(title)) {
    return null;
  }
  const sanitized = sanitizeCompletedFileName(title);
  const stem = completedFileStem(sanitized);
  if (!stem || isGenericStem(stem) || isHashLikeTitle(stem)) {
    return null;
  }
  return stem;
}

function dispositionStem(raw: string | null | undefined): string | null {
  if (!raw?.trim()) {
    return null;
  }
  // Strip incompatible extension — container authority replaces it later.
  const sanitized = sanitizeCompletedFileName(raw);
  const stem = completedFileStem(sanitized);
  if (!stem || isGenericStem(stem) || isHashLikeTitle(stem)) {
    return null;
  }
  // Traversal / absolute residues already neutralized by sanitize.
  return stem;
}

export type ResolveCompletedFileNameInput = {
  downloadId: string;
  currentFileName?: string | null;
  displayTitle?: string | null;
  platform?: string | null;
  sourceUrl?: string | null;
  sourceHost?: string | null;
  qualityLabel?: string | null;
  completedAt?: string | null;
  evidence?: CompletedValidationEvidence | null;
  /** When true, keep current stem; only correct extension. */
  preserveExistingBaseName?: boolean;
  /** Optional fixed date for deterministic tests. */
  now?: Date;
};

/**
 * Resolve a deterministic completed basename + authoritative extension.
 * Never embeds signed query, cookies, auth, or full source URLs.
 */
export function resolveCompletedFileName(input: ResolveCompletedFileNameInput): string {
  const extension =
    resolveCompletedExtension(input.evidence, input.currentFileName) ?? 'bin';

  const currentStem = input.currentFileName
    ? completedFileStem(sanitizeCompletedFileName(input.currentFileName))
    : '';

  if (input.preserveExistingBaseName && currentStem && !isGenericStem(currentStem)) {
    return joinCompletedFileName(currentStem, extension);
  }

  const fromTitle = titleStem(input.displayTitle);
  if (fromTitle) {
    return joinCompletedFileName(fromTitle, extension);
  }

  const fromDisposition = dispositionStem(input.evidence?.contentDispositionFileName);
  if (fromDisposition) {
    return joinCompletedFileName(fromDisposition, extension);
  }

  if (currentStem && !isGenericStem(currentStem) && !isHashLikeTitle(currentStem)) {
    // Keep a useful create-time stem (e.g. VidoraX_TikTok_…) when title is empty.
    const currentExt = completedFileExtension(input.currentFileName ?? '');
    // Drop playlist-like extensions from stem path — extension authority wins.
    void currentExt;
    return joinCompletedFileName(currentStem, extension);
  }

  const date = (() => {
    if (input.completedAt) {
      const parsed = new Date(input.completedAt);
      if (!Number.isNaN(parsed.getTime())) {
        return formatDateStamp(parsed);
      }
    }
    return formatDateStamp(input.now ?? new Date());
  })();

  const social = platformSlug(input.platform);
  if (social) {
    return joinCompletedFileName(`${social}_${date}`, extension);
  }

  const host = hostSlug(input.sourceHost ?? sourceHostFromUrl(input.sourceUrl));
  const quality =
    typeof input.qualityLabel === 'string' &&
    /^[0-9]{3,4}p$/i.test(input.qualityLabel.trim())
      ? input.qualityLabel.trim().toLowerCase()
      : null;

  if (host) {
    const withQuality = quality ? `${host}_video_${quality}` : `${host}_video`;
    return joinCompletedFileName(withQuality, extension);
  }

  const container = resolveCompletedContainer(input.evidence, input.currentFileName);
  const mediaWord = container === 'm4a' ? 'audio' : 'video';
  return joinCompletedFileName(
    `${mediaWord}_${date}_${shortDownloadId(input.downloadId)}`,
    extension,
  );
}
