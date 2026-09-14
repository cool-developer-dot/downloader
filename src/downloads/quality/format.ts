/**
 * Display helpers for quality selection — omit unknown values.
 * Hierarchy: label → type/bitrate → codec/size
 */

import { formatDuration, formatFileSize } from '@/media-detection/utils';

import type { AnalysisUnsupportedReason } from '../../api/types';

import type { AnalyzedMediaSelection, DownloadQualityOption, QualityOption } from './types';

/** Display-only container / stream label. */
export function formatContainerLabel(
  container: QualityOption['container'] | null | undefined,
): string | null {
  if (!container || container === 'unknown') {
    return null;
  }
  switch (container) {
    case 'mp4':
      return 'MP4';
    case 'webm':
      return 'WebM';
    case 'mov':
      return 'MOV';
    case 'm4v':
      return 'M4V';
    case 'mp3':
      return 'MP3';
    case 'm4a':
      return 'M4A';
    case 'aac':
      return 'AAC';
    case 'ogg':
      return 'OGG';
    case 'hls':
      return 'HLS';
    default:
      return null;
  }
}

/**
 * Progressive → container (MP4). HLS → HLS.
 * Never expose PROGRESSIVE enum to users.
 */
export function formatStreamPresentation(
  option: Pick<DownloadQualityOption, 'streamType' | 'isHls' | 'container'>,
): string | null {
  if (option.isHls || option.streamType === 'HLS' || option.container === 'hls') {
    return 'HLS';
  }
  return formatContainerLabel(option.container);
}

/** Safe bitrate display. Returns null for missing/non-positive values. */
export function formatQualityBitrate(
  bps: number | null | undefined,
): string | null {
  if (typeof bps !== 'number' || !Number.isFinite(bps) || bps <= 0) {
    return null;
  }

  if (bps >= 1_000_000) {
    const mbps = bps / 1_000_000;
    const text = mbps >= 10 ? mbps.toFixed(0) : mbps.toFixed(1);
    return `${text} Mbps`;
  }

  if (bps >= 1_000) {
    return `${Math.round(bps / 1_000)} Kbps`;
  }

  return `${Math.round(bps)} bps`;
}

export function formatQualityFileSize(
  fileSize: string | number | null | undefined,
): string | null {
  if (fileSize == null || fileSize === '') {
    return null;
  }
  const bytes = typeof fileSize === 'number' ? fileSize : Number(fileSize);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }
  const formatted = formatFileSize(bytes);
  return formatted ? `≈ ${formatted}` : null;
}

export function formatQualityCodecs(
  option: Pick<DownloadQualityOption, 'videoCodec' | 'audioCodec' | 'codec' | 'rawCodec'>,
): string | null {
  const video = option.videoCodec?.trim() || null;
  const audio = option.audioCodec?.trim() || null;
  if (video && audio) {
    return `${video} / ${audio}`;
  }
  if (video) {
    return video;
  }
  if (audio) {
    return audio;
  }
  const raw = option.codec?.trim() || option.rawCodec?.trim() || null;
  return raw || null;
}

/** @deprecated Prefer formatStreamPresentation for secondary line. */
export function formatTrackSummary(option: QualityOption): string | null {
  if (option.hasVideo === true && option.hasAudio === true) {
    return 'Video + Audio';
  }
  if (option.hasVideo === true && option.hasAudio === false) {
    return 'Video only';
  }
  if (option.hasAudio === true && option.hasVideo === false) {
    return 'Audio';
  }
  if (option.mediaType === 'audio' || option.isAudioOnly) {
    return 'Audio';
  }
  if (option.mediaType === 'video') {
    return 'Video';
  }
  if (option.mediaType === 'stream' || option.isHls) {
    return 'Stream';
  }
  return null;
}

/**
 * Secondary line: type · bitrate
 * Example: HLS · 4.1 Mbps | MP4 · 8.2 Mbps | MP4
 */
export function buildQualityMetaLine(option: QualityOption): string | null {
  const parts = [
    formatStreamPresentation(option),
    formatQualityBitrate(option.averageBitrate ?? option.bitrate),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Tertiary line: codec · size
 * Example: H.264 / AAC | H.264 · ≈ 92 MB
 */
export function buildQualitySecondaryLine(option: QualityOption): string | null {
  const parts = [
    formatQualityCodecs(option),
    formatQualityFileSize(option.estimatedFileSize ?? option.fileSize),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' · ') : null;
}

export function buildMediaInfoLine(selection: AnalyzedMediaSelection): string | null {
  const parts = [
    formatContainerLabel(selection.container),
    formatDuration(selection.duration),
    selection.mediaType === 'audio'
      ? 'Audio'
      : selection.mediaType === 'video'
        ? 'Video'
        : selection.mediaType === 'stream'
          ? 'Stream'
          : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' · ') : null;
}

export function unsupportedReasonCopy(
  reason: AnalysisUnsupportedReason | null | undefined,
): string {
  switch (reason) {
    case 'UNSUPPORTED_STREAM':
      return 'This stream was detected but can’t be downloaded yet.';
    case 'UNSUPPORTED_FORMAT':
      return 'This format isn’t supported for download.';
    case 'ENCRYPTED_MEDIA':
      return 'This media is encrypted and can’t be downloaded.';
    case 'DRM_PROTECTED':
      return 'This media is DRM protected and can’t be downloaded.';
    case 'NO_MEDIA':
      return 'No downloadable media was found at this link.';
    case 'NETWORK_ERROR':
      return 'The source couldn’t be reached. Check the link and try again.';
    case 'INVALID_URL':
      return 'That link isn’t valid.';
    case 'ANALYSIS_FAILED':
      return 'Something went wrong while analyzing this link.';
    default:
      return 'No downloadable formats are available for this link.';
  }
}

export function buildQualityAccessibilityLabel(
  option: QualityOption,
  selected: boolean,
): string {
  const parts = [option.label];
  const meta = buildQualityMetaLine(option);
  const secondary = buildQualitySecondaryLine(option);

  if (meta) {
    parts.push(meta.replace('·', ',').replace('Mbps', 'megabits per second').replace('Kbps', 'kilobits per second'));
  }
  if (secondary) {
    parts.push(secondary.replace('·', ',').replace('/', 'and').replace('≈', 'about'));
  }

  if (!option.downloadable) {
    parts.push('unsupported for download');
  } else if (selected) {
    parts.push('selected');
  }

  return parts.join(', ');
}

export function resolveDisplayTitle(selection: AnalyzedMediaSelection): string {
  if (selection.title?.trim()) {
    return selection.title.trim();
  }

  try {
    const path = new URL(selection.finalUrl).pathname.split('/').filter(Boolean).pop();
    if (path) {
      return decodeURIComponent(path);
    }
  } catch {
    // fall through
  }

  return 'Media';
}

export function resolveDisplayHost(selection: AnalyzedMediaSelection): string | null {
  try {
    return new URL(selection.finalUrl).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}
