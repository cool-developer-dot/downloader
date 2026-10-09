/**
 * Map a selected quality option back to the create-download contract.
 * Durable subset (quality / resolution / bitrate) reaches POST /downloads;
 * the full analyzer object stays analysis-time only.
 */

import type { AnalyzedMediaSelection, DownloadQualityOption, QualityOption } from './types';
import {
  resolveDownloadFileName,
  resolveDownloadTitle,
} from './download-metadata';

/** Selected variant metadata preserved through local create mapping. */
export type SelectedQualityMetadata = {
  id: string;
  label: string;
  sourceUrl: string;
  resolution: string | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  averageBitrate: number | null;
  videoBitrate: number | null;
  audioBitrate: number | null;
  container: DownloadQualityOption['container'];
  mimeType: string | null;
  streamType: DownloadQualityOption['streamType'];
  codec: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  estimatedFileSize: number | null;
};

export type CreateDownloadFromQualityInput = {
  title: string;
  /** MUST be the selected variant URL — never the unresolved master unless identical. */
  sourceUrl: string;
  platform: string;
  thumbnailUrl: string;
  fileName: string;
  fileSize: string | number;
  /** Canonical quality label for durable persistence. */
  quality: string | null;
  /** Normalized WIDTHxHEIGHT when known. */
  resolution: string | null;
  /** Bits/sec when known — never 0-as-unknown. */
  bitrate: number | null;
  /** Rich local selection metadata (not all fields are posted). */
  selectedQuality: SelectedQualityMetadata;
};

export type ApiCreateDownloadPayload = {
  title: string;
  sourceUrl: string;
  platform: string;
  thumbnailUrl: string;
  fileName: string;
  fileSize: string | number;
  quality: string | null;
  resolution: string | null;
  bitrate: number | null;
};

function sanitizePlatform(platform: string): string {
  const trimmed = platform.trim().toUpperCase();
  if (/^[A-Z][A-Z0-9_]{0,49}$/.test(trimmed)) {
    return trimmed;
  }
  return 'OTHER';
}

function preferredContainerExt(option: QualityOption): string {
  if (option.container === 'hls') {
    return 'ts';
  }
  if (option.container !== 'unknown') {
    return option.container;
  }
  if (option.mimeType?.includes('webm')) {
    return 'webm';
  }
  return 'mp4';
}

function placeholderThumbnail(selection: AnalyzedMediaSelection): string {
  if (selection.thumbnailUrl?.trim()) {
    return selection.thumbnailUrl.trim();
  }
  try {
    const host = new URL(selection.finalUrl || selection.sourceUrl).hostname;
    if (host) {
      return `https://${host}/favicon.ico`;
    }
  } catch {
    // fall through
  }
  return 'https://vidorax.app/favicon.ico';
}

function toSelectedQualityMetadata(option: DownloadQualityOption): SelectedQualityMetadata {
  return {
    id: option.id,
    label: option.label,
    sourceUrl: option.sourceUrl,
    resolution: option.resolution,
    width: option.width,
    height: option.height,
    bitrate: option.bitrate,
    averageBitrate: option.averageBitrate,
    videoBitrate: option.videoBitrate,
    audioBitrate: option.audioBitrate,
    container: option.container,
    mimeType: option.mimeType,
    streamType: option.streamType,
    codec: option.codec,
    videoCodec: option.videoCodec,
    audioCodec: option.audioCodec,
    estimatedFileSize: option.estimatedFileSize,
  };
}

/** Prefer explicit bitrate, then average — never invent. */
function resolveDurableBitrate(option: DownloadQualityOption): number | null {
  const candidates = [option.bitrate, option.averageBitrate, option.videoBitrate];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.trunc(value);
    }
  }
  return null;
}

function resolveDurableQuality(option: DownloadQualityOption): string | null {
  const label = option.label?.trim();
  return label ? label.slice(0, 64) : null;
}

function resolveDurableResolution(option: DownloadQualityOption): string | null {
  if (option.resolution && /^[1-9]\d{1,4}x[1-9]\d{1,4}$/i.test(option.resolution.trim())) {
    return option.resolution.trim().toLowerCase();
  }
  if (
    typeof option.width === 'number' &&
    typeof option.height === 'number' &&
    option.width >= 10 &&
    option.height >= 10
  ) {
    return `${Math.trunc(option.width)}x${Math.trunc(option.height)}`;
  }
  return null;
}

/**
 * Build create payload from the selected downloadable option.
 * Returns null if the option is missing or not downloadable.
 */
export function toCreateDownloadInput(
  selection: AnalyzedMediaSelection,
  option: QualityOption | null,
): CreateDownloadFromQualityInput | null {
  if (!option || !option.downloadable || !option.sourceUrl) {
    return null;
  }

  const platform = sanitizePlatform(selection.platform || 'OTHER');
  const title = resolveDownloadTitle({
    title: selection.title,
    platform,
    pageTitle: selection.raw?.title ?? null,
  });
  const ext = preferredContainerExt(option);
  const fileName = resolveDownloadFileName({
    title,
    platform,
    containerExt: ext,
  });

  const fileSizeValue = option.fileSize ?? option.estimatedFileSize ?? 0;
  const numericSize =
    typeof fileSizeValue === 'number' ? fileSizeValue : Number(fileSizeValue);
  if (Number.isFinite(numericSize) && numericSize > 0 && numericSize < 16_384) {
    return null;
  }

  return {
    title: title.slice(0, 255),
    sourceUrl: option.sourceUrl,
    platform,
    thumbnailUrl: placeholderThumbnail(selection),
    fileName,
    fileSize: option.fileSize ?? option.estimatedFileSize ?? 0,
    quality: resolveDurableQuality(option),
    resolution: resolveDurableResolution(option),
    bitrate: resolveDurableBitrate(option),
    selectedQuality: toSelectedQualityMetadata(option),
  };
}

/** API-safe durable fields for POST /downloads. */
export function toApiCreateDownloadPayload(
  input: CreateDownloadFromQualityInput,
): ApiCreateDownloadPayload {
  return {
    title: input.title,
    sourceUrl: input.sourceUrl,
    platform: input.platform,
    thumbnailUrl: input.thumbnailUrl,
    fileName: input.fileName,
    fileSize: input.fileSize,
    quality: input.quality,
    resolution: input.resolution,
    bitrate: input.bitrate,
  };
}
