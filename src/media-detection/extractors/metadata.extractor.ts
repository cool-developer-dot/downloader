import type { DetectedMedia, MediaCandidate } from '../types';
import {
  buildMediaId,
  computeAspectRatio,
  derivePlatformHint,
  formatResolution,
  isSafeMediaUrl,
  normalizeMediaUrl,
  sanitizeFiniteNumber,
  scoreConfidence,
} from '../utils';
import {
  resolveCategory,
  resolveContainer,
  resolveExtension,
  resolveMimeType,
  resolveStreamType,
} from '../parsers';

/**
 * Enrich a validated candidate into DetectedMedia.
 * Missing fields stay null — never invent values.
 */
export function extractDetectedMedia(candidate: MediaCandidate): DetectedMedia | null {
  const extension =
    candidate.extension ?? resolveExtension(candidate.url, candidate.mimeType);
  let container = resolveContainer(extension);

  if (candidate.streamProtocol === 'hls' || candidate.streamType === 'HLS') {
    container = 'hls';
  } else if (candidate.streamProtocol === 'dash' || candidate.streamType === 'DASH') {
    container = 'dash';
  }

  const category =
    resolveCategory(container, extension) ??
    (candidate.mimeType?.startsWith('audio/')
      ? 'audio'
      : candidate.mimeType?.startsWith('video/')
        ? 'video'
        : container === 'hls' || container === 'dash'
          ? 'stream'
          : null);

  if (!category) {
    return null;
  }

  const width = sanitizeFiniteNumber(candidate.width, { min: 1, max: 16_384 });
  const height = sanitizeFiniteNumber(candidate.height, { min: 1, max: 16_384 });
  const duration = sanitizeFiniteNumber(candidate.duration, { min: 0, max: 864_000 });
  const bitrate = sanitizeFiniteNumber(candidate.bitrate, { min: 1 });
  const fps = sanitizeFiniteNumber(candidate.fps, { min: 1, max: 240 });
  const estimatedFileSize = sanitizeFiniteNumber(candidate.estimatedFileSize, {
    min: 0,
  });

  const mimeType = resolveMimeType(extension, candidate.mimeType);
  const confidence = scoreConfidence(candidate);
  const streamType =
    candidate.streamType ?? resolveStreamType(container, category);

  const sourceUrl =
    (candidate.sourceUrl && isSafeMediaUrl(candidate.sourceUrl)
      ? normalizeMediaUrl(candidate.sourceUrl)
      : null) ?? candidate.url;
  const finalUrl =
    (candidate.finalUrl && isSafeMediaUrl(candidate.finalUrl)
      ? normalizeMediaUrl(candidate.finalUrl)
      : null) ?? candidate.url;

  const id = buildMediaId({
    url: finalUrl || candidate.url,
    mimeType,
    container,
    width,
    height,
    bitrate,
    streamProtocol: candidate.streamProtocol,
    playlistType: candidate.playlistType,
  });

  const thumbnailUrl =
    candidate.thumbnailUrl && isSafeMediaUrl(candidate.thumbnailUrl)
      ? normalizeMediaUrl(candidate.thumbnailUrl)
      : null;

  const isDrm = Boolean(candidate.isDrm);
  const isLive = Boolean(candidate.isLive);
  const downloadable =
    !isDrm &&
    container !== 'unknown' &&
    !(category === 'stream' && isLive);

  return {
    id,
    url: finalUrl || candidate.url,
    sourceUrl: sourceUrl || candidate.url,
    finalUrl: finalUrl || candidate.url,
    pageUrl: candidate.pageUrl,
    title: candidate.title?.trim().slice(0, 255) || null,
    thumbnailUrl,
    duration,
    width,
    height,
    resolution: formatResolution(width, height),
    aspectRatio: computeAspectRatio(width, height),
    fps,
    estimatedFileSize,
    codec: candidate.codec ?? null,
    audioCodec: candidate.audioCodec ?? null,
    bitrate,
    mimeType,
    extension,
    container,
    category,
    streamType,
    isLive,
    isDrm,
    playlistType: candidate.playlistType ?? null,
    streamProtocol:
      candidate.streamProtocol ??
      (container === 'hls' ? 'hls' : container === 'dash' ? 'dash' : null),
    websiteSource: derivePlatformHint(candidate.pageUrl),
    detectionSource: candidate.detectionSource,
    sourceDetector: candidate.detectionSource,
    detectedAt: Date.now(),
    confidence,
    downloadable,
    requiresCookies: Boolean(candidate.requiresCookies),
    requiredHeaders: candidate.requiredHeaders ?? null,
    redirectCount: candidate.redirectCount ?? 0,
    platformHint: derivePlatformHint(candidate.pageUrl),
    hasSeparateAudio: Boolean(candidate.hasSeparateAudio),
    videoOnly: Boolean(candidate.videoOnly),
  };
}
