/**
 * Normalize Analyze response into canonical DownloadQualityOption[].
 * ONE mapping path for Browser + Paste Link. Never manufactures qualities.
 */

import type {
  MediaAnalysisResult,
  MediaAnalysisStreamType,
  MediaAnalysisVariant,
} from '../../api/types';

import type {
  AnalyzedMediaSelection,
  DownloadQualityOption,
  DownloadStreamType,
  QualityOption,
} from './types';

function parseHeightFromResolution(resolution: string | null): number | null {
  if (!resolution) {
    return null;
  }
  const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(resolution.trim());
  if (!match) {
    return null;
  }
  const height = Number(match[2]);
  return Number.isFinite(height) && height > 0 ? height : null;
}

function deriveStreamFlags(streamType: DownloadStreamType, isAudioOnly: boolean) {
  return {
    isHls: streamType === 'HLS',
    isProgressive: streamType === 'PROGRESSIVE',
    isAudioOnly: isAudioOnly || streamType === 'AUDIO',
  };
}

function inferTracks(option: {
  mediaType: MediaAnalysisResult['mediaType'];
  streamType: DownloadStreamType;
  isAudioOnly: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
}): Pick<DownloadQualityOption, 'hasAudio' | 'hasVideo'> {
  if (option.isAudioOnly || option.streamType === 'AUDIO' || option.mediaType === 'audio') {
    return { hasAudio: true, hasVideo: false };
  }

  if (option.videoCodec && option.audioCodec) {
    return { hasAudio: true, hasVideo: true };
  }
  if (option.videoCodec && !option.audioCodec) {
    return { hasAudio: null, hasVideo: true };
  }
  if (!option.videoCodec && option.audioCodec) {
    return { hasAudio: true, hasVideo: false };
  }

  if (option.mediaType === 'video') {
    return { hasAudio: null, hasVideo: true };
  }
  if (option.mediaType === 'stream') {
    return { hasAudio: null, hasVideo: null };
  }
  return { hasAudio: null, hasVideo: null };
}

/**
 * Evidence-only label policy (local domain).
 * Known height → "{height}p"; otherwise "Original Quality".
 */
export function buildQualityLabel(input: {
  height?: number | null;
  resolution?: string | null;
  streamType?: DownloadStreamType | null;
  container?: DownloadQualityOption['container'] | null;
  isAudioOnly?: boolean;
}): string {
  const height =
    (typeof input.height === 'number' &&
    Number.isFinite(input.height) &&
    input.height > 0
      ? Math.trunc(input.height)
      : null) ?? parseHeightFromResolution(input.resolution ?? null);

  if (height != null) {
    return `${height}p`;
  }

  if (input.isAudioOnly || input.streamType === 'AUDIO') {
    if (
      input.container &&
      input.container !== 'unknown' &&
      input.container !== 'hls'
    ) {
      return input.container.toUpperCase();
    }
  }

  return 'Original Quality';
}

function resolveLegacyStreamType(
  analysis: MediaAnalysisResult,
): DownloadStreamType {
  if (analysis.container === 'hls' || analysis.mediaType === 'stream') {
    return 'HLS';
  }
  if (analysis.mediaType === 'audio') {
    return 'AUDIO';
  }
  if (analysis.mediaType === 'video') {
    return 'PROGRESSIVE';
  }
  return 'UNKNOWN';
}

function coerceStreamType(
  value: MediaAnalysisStreamType | null | undefined,
  fallback: DownloadStreamType,
): DownloadStreamType {
  if (
    value === 'PROGRESSIVE' ||
    value === 'HLS' ||
    value === 'DASH' ||
    value === 'AUDIO' ||
    value === 'UNKNOWN'
  ) {
    return value;
  }
  return fallback;
}

function estimatedSizeToFileSize(
  estimated: number | null | undefined,
  legacy: string | null | undefined,
): { fileSize: string | null; estimatedFileSize: number | null } {
  if (typeof estimated === 'number' && Number.isFinite(estimated) && estimated >= 0) {
    return {
      fileSize: String(Math.trunc(estimated)),
      estimatedFileSize: Math.trunc(estimated),
    };
  }
  if (typeof legacy === 'string' && /^\d+$/.test(legacy)) {
    const asNumber = Number(legacy);
    return {
      fileSize: legacy,
      estimatedFileSize: Number.isSafeInteger(asNumber) ? asNumber : null,
    };
  }
  return { fileSize: null, estimatedFileSize: null };
}

function mapVariantToOption(
  variant: MediaAnalysisVariant,
  analysis: MediaAnalysisResult,
): DownloadQualityOption | null {
  if (!variant || typeof variant !== 'object') {
    return null;
  }

  const sourceUrl =
    typeof variant.sourceUrl === 'string' && variant.sourceUrl.trim()
      ? variant.sourceUrl.trim()
      : '';
  if (!sourceUrl) {
    return null;
  }

  const streamType = coerceStreamType(
    variant.streamType,
    resolveLegacyStreamType(analysis),
  );
  const height =
    typeof variant.height === 'number' && variant.height > 0
      ? Math.trunc(variant.height)
      : null;
  const width =
    typeof variant.width === 'number' && variant.width > 0
      ? Math.trunc(variant.width)
      : null;
  const codecs =
    typeof variant.codecs === 'string' && variant.codecs.trim()
      ? variant.codecs.trim()
      : null;
  const videoCodec =
    typeof variant.videoCodec === 'string' ? variant.videoCodec : null;
  const audioCodec =
    typeof variant.audioCodec === 'string' ? variant.audioCodec : null;
  const isAudioOnly =
    streamType === 'AUDIO' ||
    (videoCodec == null && audioCodec != null && height == null);

  const flags = deriveStreamFlags(streamType, isAudioOnly);
  const sizes = estimatedSizeToFileSize(variant.estimatedFileSize, null);
  const frameRate =
    typeof variant.frameRate === 'number' && variant.frameRate > 0
      ? variant.frameRate
      : null;
  const container = variant.container || analysis.container || 'unknown';
  const label =
    (typeof variant.label === 'string' && variant.label.trim()) ||
    buildQualityLabel({
      height,
      resolution: variant.resolution,
      streamType,
      container,
      isAudioOnly,
    });

  const mediaType =
    streamType === 'AUDIO'
      ? 'audio'
      : streamType === 'HLS'
        ? 'stream'
        : streamType === 'PROGRESSIVE' || streamType === 'DASH'
          ? 'video'
          : analysis.mediaType;

  const tracks = inferTracks({
    mediaType,
    streamType,
    isAudioOnly,
    videoCodec,
    audioCodec,
  });

  const bitrate =
    typeof variant.bitrate === 'number' && variant.bitrate > 0
      ? Math.trunc(variant.bitrate)
      : typeof variant.averageBitrate === 'number' && variant.averageBitrate > 0
        ? Math.trunc(variant.averageBitrate)
        : null;

  return {
    id:
      typeof variant.id === 'string' && variant.id.trim()
        ? variant.id
        : `vq:${streamType}:${width ?? ''}x${height ?? ''}:${bitrate ?? ''}:${container}:${sourceUrl}`,
    label,
    sourceUrl,
    resolution:
      typeof variant.resolution === 'string' ? variant.resolution : null,
    width,
    height,
    bitrate:
      typeof variant.bitrate === 'number' && variant.bitrate > 0
        ? Math.trunc(variant.bitrate)
        : null,
    averageBitrate:
      typeof variant.averageBitrate === 'number' && variant.averageBitrate > 0
        ? Math.trunc(variant.averageBitrate)
        : null,
    videoBitrate:
      typeof variant.videoBitrate === 'number' && variant.videoBitrate > 0
        ? Math.trunc(variant.videoBitrate)
        : null,
    audioBitrate:
      typeof variant.audioBitrate === 'number' && variant.audioBitrate > 0
        ? Math.trunc(variant.audioBitrate)
        : null,
    codec: codecs,
    videoCodec,
    audioCodec,
    rawCodec: codecs,
    container,
    mimeType: typeof variant.mimeType === 'string' ? variant.mimeType : null,
    fileSize: sizes.fileSize,
    estimatedFileSize: sizes.estimatedFileSize,
    fps: frameRate,
    frameRate,
    streamType,
    isHls: flags.isHls,
    isProgressive: flags.isProgressive,
    isAudioOnly: flags.isAudioOnly,
    mediaType,
    hasAudio: tracks.hasAudio,
    hasVideo: tracks.hasVideo,
    downloadable: variant.downloadable === true,
    unavailableReason: variant.downloadable
      ? null
      : (variant.unsupportedReason ?? analysis.unsupportedReason),
    ...(streamType === 'DASH' && variant.representationId
      ? { representationId: variant.representationId }
      : {}),
  };
}

/**
 * Legacy single-result fallback when `variants` is absent (pre-Week-7 servers).
 */
function mapLegacyAnalysisToOption(
  analysis: MediaAnalysisResult,
): DownloadQualityOption | null {
  const isDetected =
    analysis.mediaType != null ||
    analysis.container !== 'unknown' ||
    (analysis.mimeType != null && analysis.downloadable === true);

  if (!isDetected) {
    return null;
  }

  const sourceUrl = analysis.finalUrl || analysis.sourceUrl;
  if (!sourceUrl) {
    return null;
  }

  const streamType = resolveLegacyStreamType(analysis);
  const height =
    analysis.height ?? parseHeightFromResolution(analysis.resolution);
  const isAudioOnly = streamType === 'AUDIO' || analysis.mediaType === 'audio';
  const flags = deriveStreamFlags(streamType, isAudioOnly);
  const sizes = estimatedSizeToFileSize(null, analysis.fileSize);
  const label = buildQualityLabel({
    height,
    resolution: analysis.resolution,
    streamType,
    container: analysis.container,
    isAudioOnly,
  });
  const tracks = inferTracks({
    mediaType: analysis.mediaType,
    streamType,
    isAudioOnly,
    videoCodec: null,
    audioCodec: null,
  });

  return {
    id: `analysis:${sourceUrl}:${analysis.container}:${label}`,
    label,
    sourceUrl,
    resolution: analysis.resolution,
    width: analysis.width,
    height: analysis.height,
    bitrate: analysis.bitrate,
    averageBitrate: null,
    videoBitrate: null,
    audioBitrate: null,
    codec: null,
    videoCodec: null,
    audioCodec: null,
    rawCodec: null,
    container: analysis.container || 'unknown',
    mimeType: analysis.mimeType,
    fileSize: sizes.fileSize,
    estimatedFileSize: sizes.estimatedFileSize,
    fps: analysis.fps,
    frameRate: analysis.fps,
    streamType,
    isHls: flags.isHls,
    isProgressive: flags.isProgressive,
    isAudioOnly: flags.isAudioOnly,
    mediaType: analysis.mediaType,
    hasAudio: tracks.hasAudio,
    hasVideo: tracks.hasVideo,
    downloadable: analysis.downloadable === true,
    unavailableReason: analysis.downloadable
      ? null
      : analysis.unsupportedReason,
  };
}

/**
 * Deterministic quality ordering (numeric media characteristics, not labels):
 * 1. Video before audio-only
 * 2. Known height desc
 * 3. Known width desc
 * 4. Effective bitrate desc
 * 5. Stable original order
 */
export function sortQualityOptions(
  options: DownloadQualityOption[],
): DownloadQualityOption[] {
  return options
    .map((option, index) => ({ option, index }))
    .sort((a, b) => {
      const audioA = a.option.isAudioOnly ? 1 : 0;
      const audioB = b.option.isAudioOnly ? 1 : 0;
      if (audioA !== audioB) {
        return audioA - audioB;
      }

      const heightA = a.option.height;
      const heightB = b.option.height;
      const knownA = heightA != null ? 1 : 0;
      const knownB = heightB != null ? 1 : 0;
      if (knownA !== knownB) {
        return knownB - knownA;
      }
      if (heightA != null && heightB != null && heightA !== heightB) {
        return heightB - heightA;
      }

      const widthA = a.option.width;
      const widthB = b.option.width;
      const knownWA = widthA != null ? 1 : 0;
      const knownWB = widthB != null ? 1 : 0;
      if (knownWA !== knownWB) {
        return knownWB - knownWA;
      }
      if (widthA != null && widthB != null && widthA !== widthB) {
        return widthB - widthA;
      }

      const brA = a.option.averageBitrate ?? a.option.bitrate ?? -1;
      const brB = b.option.averageBitrate ?? b.option.bitrate ?? -1;
      if (brA !== brB) {
        return brB - brA;
      }

      return a.index - b.index;
    })
    .map((entry) => entry.option);
}

/**
 * Convert Analyze payload into the selection surface model.
 * Prefers `variants[]`; falls back to legacy single-result shape.
 */
export function normalizeAnalysisToSelection(
  analysis: MediaAnalysisResult,
): AnalyzedMediaSelection {
  if (!analysis || typeof analysis !== 'object') {
    return {
      title: null,
      thumbnailUrl: null,
      sourceUrl: '',
      finalUrl: '',
      platform: 'OTHER',
      mediaType: null,
      mimeType: null,
      container: 'unknown',
      duration: null,
      options: [],
      unsupportedReason: 'ANALYSIS_FAILED',
      raw: analysis,
    };
  }

  const safeAnalysis: MediaAnalysisResult = {
    ...analysis,
    title: typeof analysis.title === 'string' ? analysis.title : null,
    sourceUrl: typeof analysis.sourceUrl === 'string' ? analysis.sourceUrl : '',
    finalUrl:
      typeof analysis.finalUrl === 'string' && analysis.finalUrl
        ? analysis.finalUrl
        : typeof analysis.sourceUrl === 'string'
          ? analysis.sourceUrl
          : '',
    thumbnailUrl:
      typeof analysis.thumbnailUrl === 'string' ? analysis.thumbnailUrl : null,
    mediaType: analysis.mediaType ?? null,
    mimeType: typeof analysis.mimeType === 'string' ? analysis.mimeType : null,
    container: analysis.container || 'unknown',
    duration: typeof analysis.duration === 'number' ? analysis.duration : null,
    width: typeof analysis.width === 'number' ? analysis.width : null,
    height: typeof analysis.height === 'number' ? analysis.height : null,
    resolution:
      typeof analysis.resolution === 'string' ? analysis.resolution : null,
    bitrate: typeof analysis.bitrate === 'number' ? analysis.bitrate : null,
    fps: typeof analysis.fps === 'number' ? analysis.fps : null,
    fileSize: typeof analysis.fileSize === 'string' ? analysis.fileSize : null,
    platform:
      typeof analysis.platform === 'string' && analysis.platform.trim()
        ? analysis.platform
        : 'OTHER',
    downloadable: analysis.downloadable === true,
    unsupportedReason: analysis.unsupportedReason ?? null,
    variants: Array.isArray(analysis.variants) ? analysis.variants : undefined,
  };

  let options: DownloadQualityOption[] = [];

  if (Array.isArray(safeAnalysis.variants) && safeAnalysis.variants.length > 0) {
    options = safeAnalysis.variants
      .map((variant) => mapVariantToOption(variant, safeAnalysis))
      .filter((option): option is DownloadQualityOption => option != null);
  } else {
    const legacy = mapLegacyAnalysisToOption(safeAnalysis);
    if (legacy) {
      options = [legacy];
    }
  }

  const sorted = sortQualityOptions(options);

  return {
    title: safeAnalysis.title?.trim() || null,
    thumbnailUrl: safeAnalysis.thumbnailUrl,
    sourceUrl: safeAnalysis.sourceUrl,
    finalUrl: safeAnalysis.finalUrl || safeAnalysis.sourceUrl,
    platform: safeAnalysis.platform,
    mediaType: safeAnalysis.mediaType,
    mimeType: safeAnalysis.mimeType,
    container: safeAnalysis.container,
    duration: safeAnalysis.duration,
    options: sorted,
    unsupportedReason: safeAnalysis.unsupportedReason,
    raw: safeAnalysis,
  };
}

/**
 * Default = highest downloadable option.
 * Returns null when nothing can be downloaded.
 */
export function selectDefaultQualityOption(
  options: DownloadQualityOption[],
): DownloadQualityOption | null {
  const downloadable = options.filter((option) => option.downloadable);
  if (downloadable.length === 0) {
    return null;
  }
  return sortQualityOptions(downloadable)[0] ?? null;
}

export function findQualityOptionById(
  options: DownloadQualityOption[],
  id: string | null | undefined,
): DownloadQualityOption | null {
  if (!id) {
    return null;
  }
  return options.find((option) => option.id === id && option.downloadable) ?? null;
}

export type { QualityOption };
