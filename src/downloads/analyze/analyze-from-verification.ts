/**
 * Fast analyze path — reuse verified candidate probe instead of duplicate network round-trip.
 */

import type { MediaAnalysisResult } from '@/api/types';
import type { CandidateVerification } from '@/media-detection/services/candidate-verifier.service';
import type { DetectedMedia } from '@/media-detection/types';

import {
  applyPrimarySummary,
  contentLengthToEstimatedSize,
  createVariant,
  derivePlatform,
  emptyAnalysis,
  parseFileSize,
  resolveContainer,
  resolveExtension,
  resolveMediaType,
} from './format';

function resolvePageTitle(media: DetectedMedia, pageUrl: string): string | null {
  const candidates = [media.title, media.websiteSource].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  return candidates[0]?.trim().slice(0, 255) ?? null;
}

function resolvePlatformFromPage(
  media: DetectedMedia,
  pageUrl: string,
  cdnUrl: string,
): string {
  const page = pageUrl.toLowerCase();
  if (page.includes('tiktok')) {
    return 'TIKTOK';
  }
  if (page.includes('instagram')) {
    return 'INSTAGRAM';
  }
  return derivePlatform(cdnUrl);
}

/**
 * Build a MediaAnalysisResult from an already-verified social candidate.
 * Skips the second full inspectSource round-trip during page resolution.
 */
export function buildAnalysisFromVerification(
  verification: CandidateVerification,
  media: DetectedMedia,
  pageUrl: string,
): MediaAnalysisResult {
  const finalUrl = verification.finalUrl;
  const headerMime = verification.mimeType;
  const extension = resolveExtension(finalUrl, headerMime);
  const container = resolveContainer(extension, headerMime);
  const mediaType = resolveMediaType(container, headerMime);
  const fileSizeStr = parseFileSize(
    verification.contentLength != null ? String(verification.contentLength) : null,
  );
  const estimatedSize = contentLengthToEstimatedSize(fileSizeStr);
  const platform = resolvePlatformFromPage(media, pageUrl, finalUrl);
  const title = resolvePageTitle(media, pageUrl);

  if (!mediaType || container === 'unknown') {
    return emptyAnalysis(finalUrl, {
      finalUrl,
      title,
      thumbnailUrl: media.thumbnailUrl,
      mimeType: headerMime,
      platform,
      duration: media.duration,
      width: media.width,
      height: media.height,
      resolution: media.resolution,
      bitrate: media.bitrate,
      fps: media.fps,
      fileSize: fileSizeStr,
      downloadable: false,
      unsupportedReason: 'NO_MEDIA',
      variants: [],
    });
  }

  const streamType = mediaType === 'audio' ? 'AUDIO' : 'PROGRESSIVE';
  const variants = [
    createVariant({
      sourceUrl: finalUrl,
      streamType,
      container,
      mimeType: headerMime,
      width: media.width,
      height: media.height,
      resolution: media.resolution,
      bitrate: media.bitrate,
      estimatedFileSize: estimatedSize ?? media.estimatedFileSize,
      downloadable: true,
      unsupportedReason: null,
      originalIndex: 0,
    }),
  ];

  return applyPrimarySummary(
    {
      title,
      sourceUrl: media.sourceUrl || finalUrl,
      finalUrl,
      thumbnailUrl: media.thumbnailUrl,
      mediaType,
      mimeType: headerMime,
      container,
      duration: media.duration,
      width: media.width,
      height: media.height,
      resolution: media.resolution,
      bitrate: media.bitrate,
      fps: media.fps,
      fileSize: fileSizeStr,
      platform,
      downloadable: true,
      unsupportedReason: null,
      variants: [],
    },
    variants,
  );
}
