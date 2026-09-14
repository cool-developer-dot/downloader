/**
 * Phase 7A — extension / MIME / container authority from validated evidence.
 * Strongest evidence wins. URL extension is lowest confidence.
 */

import type {
  CompletedMediaContainer,
  CompletedValidationEvidence,
} from './types';
import { completedFileExtension } from './sanitize';

const OCTET_STREAM = new Set(['application/octet-stream', 'binary/octet-stream']);

const KIND_TO_CONTAINER: Record<string, CompletedMediaContainer> = {
  mp4: 'mp4',
  webm: 'webm',
  ts: 'ts',
  m4a: 'm4a',
  mp3: 'unknown',
  mkv: 'unknown',
};

const CONTAINER_TO_EXT: Record<CompletedMediaContainer, string | null> = {
  mp4: 'mp4',
  webm: 'webm',
  ts: 'ts',
  m4a: 'm4a',
  unknown: null,
};

const CONTAINER_TO_MIME: Record<CompletedMediaContainer, string | null> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  ts: 'video/mp2t',
  m4a: 'audio/mp4',
  unknown: null,
};

const MIME_TO_CONTAINER: Record<string, CompletedMediaContainer> = {
  'video/mp4': 'mp4',
  'audio/mp4': 'm4a',
  'video/webm': 'webm',
  'audio/webm': 'webm',
  'video/mp2t': 'ts',
  'video/MP2T': 'ts',
  'application/mp2t': 'ts',
};

const EXT_TO_CONTAINER: Record<string, CompletedMediaContainer> = {
  mp4: 'mp4',
  m4v: 'mp4',
  webm: 'webm',
  ts: 'ts',
  m2ts: 'ts',
  mts: 'ts',
  m4a: 'm4a',
};

/** Playlist / segment suffixes must never become completed artifact extensions. */
const NON_FINAL_EXTENSIONS = new Set([
  'm3u8',
  'm3u',
  'mpd',
  'ism',
  'ismc',
  'part',
]);

function normalizeMime(value: string | null | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }
  const key = value.trim().split(';')[0]?.trim().toLowerCase() ?? '';
  if (!key || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(key)) {
    return null;
  }
  return key;
}

function containerFromMime(mime: string | null): CompletedMediaContainer | null {
  if (!mime || OCTET_STREAM.has(mime)) {
    return null;
  }
  return MIME_TO_CONTAINER[mime] ?? null;
}

function containerFromKind(kind: string | null | undefined): CompletedMediaContainer | null {
  if (!kind?.trim()) {
    return null;
  }
  const key = kind.trim().toLowerCase();
  if (key === 'html' || key === 'json' || key === 'unknown') {
    return null;
  }
  return KIND_TO_CONTAINER[key] ?? null;
}

function containerFromHint(hint: string | null | undefined): CompletedMediaContainer | null {
  if (!hint?.trim()) {
    return null;
  }
  const key = hint.trim().toLowerCase().replace(/^\./, '');
  if (key === 'hls' || key === 'm3u8') {
    // Playlist is not a completed artifact container.
    return null;
  }
  if (key === 'fmp4' || key === 'mp4' || key === 'isom') {
    return 'mp4';
  }
  if (key === 'webm') {
    return 'webm';
  }
  if (key === 'ts' || key === 'mpegts') {
    return 'ts';
  }
  if (key === 'm4a') {
    return 'm4a';
  }
  return EXT_TO_CONTAINER[key] ?? null;
}

function containerFromExtension(ext: string | null | undefined): CompletedMediaContainer | null {
  if (!ext?.trim()) {
    return null;
  }
  const key = ext.trim().toLowerCase().replace(/^\./, '');
  if (NON_FINAL_EXTENSIONS.has(key)) {
    return null;
  }
  return EXT_TO_CONTAINER[key] ?? null;
}

/**
 * Resolve authoritative completed container from strongest available evidence.
 * Priority:
 * 1) Phase 1 structural signature
 * 2) trusted verified MIME
 * 3) worker/analysis container hint
 * 4) validated non-octet response MIME
 * 5) existing file extension (if not playlist)
 * 6) URL extension (lowest)
 */
export function resolveCompletedContainer(
  evidence: CompletedValidationEvidence | null | undefined,
  currentFileName?: string | null,
): CompletedMediaContainer {
  const e = evidence ?? {};

  const fromSig = containerFromKind(e.signatureKind);
  if (fromSig) {
    return fromSig;
  }

  const verified = containerFromMime(normalizeMime(e.verifiedMimeType));
  if (verified) {
    return verified;
  }

  const fromHint = containerFromHint(e.containerHint);
  if (fromHint) {
    return fromHint;
  }

  const response = normalizeMime(e.responseMimeType);
  const fromResponse = containerFromMime(response);
  if (fromResponse) {
    return fromResponse;
  }

  const fileExt = completedFileExtension(currentFileName ?? '');
  const fromFile = containerFromExtension(fileExt);
  if (fromFile) {
    return fromFile;
  }

  const fromUrl = containerFromExtension(e.urlExtension);
  if (fromUrl) {
    return fromUrl;
  }

  return 'unknown';
}

export function resolveCompletedExtension(
  evidence: CompletedValidationEvidence | null | undefined,
  currentFileName?: string | null,
): string | null {
  const container = resolveCompletedContainer(evidence, currentFileName);
  const mapped = CONTAINER_TO_EXT[container];
  if (mapped) {
    return mapped;
  }

  const fileExt = completedFileExtension(currentFileName ?? '');
  if (fileExt && !NON_FINAL_EXTENSIONS.has(fileExt)) {
    return fileExt;
  }

  const urlExt = (evidence?.urlExtension ?? '').replace(/^\./, '').toLowerCase();
  if (urlExt && !NON_FINAL_EXTENSIONS.has(urlExt) && /^[a-z0-9]{1,16}$/.test(urlExt)) {
    return urlExt;
  }

  return null;
}

export function resolveCompletedMimeType(
  evidence: CompletedValidationEvidence | null | undefined,
  currentFileName?: string | null,
): string | null {
  const container = resolveCompletedContainer(evidence, currentFileName);
  const fromContainer = CONTAINER_TO_MIME[container];
  if (fromContainer) {
    return fromContainer;
  }

  const verified = normalizeMime(evidence?.verifiedMimeType);
  if (verified && !OCTET_STREAM.has(verified)) {
    return verified;
  }

  const response = normalizeMime(evidence?.responseMimeType);
  if (response && !OCTET_STREAM.has(response)) {
    return response;
  }

  // Do not fabricate MIME for unknown containers.
  return null;
}

export function formatContainerLabel(container: CompletedMediaContainer): string | null {
  switch (container) {
    case 'mp4':
      return 'MP4';
    case 'webm':
      return 'WebM';
    case 'ts':
      return 'TS';
    case 'm4a':
      return 'M4A';
    default:
      return null;
  }
}

export function isNonFinalMediaExtension(ext: string | null | undefined): boolean {
  if (!ext) {
    return false;
  }
  return NON_FINAL_EXTENSIONS.has(ext.replace(/^\./, '').toLowerCase());
}
