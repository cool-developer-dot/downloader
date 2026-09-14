import type { MediaCandidate } from '../types';
import { isSafeMediaUrl, normalizeMediaUrl } from '../utils/url';
import { isFalsePositive } from '../services/false-positive.filter';
import {
  isSupportedMediaUrl,
  isMediaMimeType,
  resolveCategory,
  resolveContainer,
  resolveExtension,
  resolveMimeType,
  resolveStreamType,
} from './extension.parser';
import { isDashManifestUrl, isDashMimeType } from './dash.parser';
import { isHlsManifestUrl, isHlsMimeType } from './hls.parser';
import { isLikelyTikTokProgressiveMediaUrl } from '../social/tiktok-media-resource';
import {
  classifyGeneralNetworkResource,
  isPlayerDocumentResource,
} from '../general-media/general-network-resource';

/**
 * Classify a progressive (or stream URL by extension/MIME) network resource.
 * Extension alone is a candidate signal — never the sole classifier for weak types.
 */
export function parseProgressiveMediaUrl(input: {
  url: string;
  pageUrl: string;
  mimeType?: string | null;
  detectionSource: MediaCandidate['detectionSource'];
  title?: string | null;
  estimatedFileSize?: number | null;
  sourceUrl?: string | null;
  finalUrl?: string | null;
  redirectCount?: number;
  confidenceHint?: number;
  requiresCookies?: boolean;
  requiredHeaders?: MediaCandidate['requiredHeaders'];
  hasRange?: boolean;
  isForMainFrame?: boolean;
}): MediaCandidate | null {
  const url = normalizeMediaUrl(input.url);
  const pageUrl = normalizeMediaUrl(input.pageUrl);

  if (!url || !pageUrl || !isSafeMediaUrl(url) || !isSafeMediaUrl(pageUrl)) {
    return null;
  }

  const tiktokProgressive = isLikelyTikTokProgressiveMediaUrl(url);
  const classified = classifyGeneralNetworkResource({
    url,
    mimeType: input.mimeType,
    hasRange: input.hasRange,
    isForMainFrame: input.isForMainFrame,
  });
  const genericMedia =
    classified.acceptForIngest &&
    (classified.family === 'progressive' ||
      classified.family === 'hls' ||
      classified.family === 'dash');

  if (isPlayerDocumentResource(url, input.mimeType) && !tiktokProgressive) {
    return null;
  }

  if (
    isFalsePositive({
      url,
      mimeType: input.mimeType,
      confidenceHint: input.confidenceHint,
    }) &&
    !tiktokProgressive &&
    !genericMedia
  ) {
    return null;
  }

  const mimeOk = isMediaMimeType(input.mimeType) || tiktokProgressive || genericMedia;
  if (!isSupportedMediaUrl(url, input.mimeType) && !mimeOk) {
    return null;
  }

  const extension =
    resolveExtension(url, input.mimeType) ??
    (tiktokProgressive ? 'mp4' : null) ??
    (classified.family === 'hls' ? 'm3u8' : null) ??
    (classified.family === 'dash' ? 'mpd' : null) ??
    (classified.family === 'progressive' && genericMedia ? 'mp4' : null);
  let container = resolveContainer(extension);
  if (tiktokProgressive && (!container || container === 'unknown')) {
    container = 'mp4';
  }
  if (genericMedia && classified.family === 'progressive' && (!container || container === 'unknown')) {
    container = 'mp4';
  }

  if (isHlsManifestUrl(url) || isHlsMimeType(input.mimeType) || classified.family === 'hls') {
    container = 'hls';
  } else if (isDashManifestUrl(url) || isDashMimeType(input.mimeType) || classified.family === 'dash') {
    container = 'dash';
  }

  const category = resolveCategory(container, extension);
  if (!category && !mimeOk) {
    return null;
  }

  const resolvedCategory =
    category ??
    (tiktokProgressive || (genericMedia && classified.family === 'progressive')
      ? 'video'
      : input.mimeType?.startsWith('audio/')
        ? 'audio'
        : input.mimeType?.startsWith('video/')
          ? 'video'
        : container === 'hls' || container === 'dash'
          ? 'stream'
          : null);

  if (!resolvedCategory) {
    return null;
  }

  if (container === 'unknown' && mimeOk && extension) {
    container = resolveContainer(extension);
  }

  const streamType = resolveStreamType(container, resolvedCategory);
  const streamProtocol =
    container === 'hls' ? 'hls' : container === 'dash' ? 'dash' : null;

  return {
    url,
    pageUrl,
    sourceUrl: input.sourceUrl ?? url,
    finalUrl: input.finalUrl ?? url,
    mimeType: resolveMimeType(extension, input.mimeType),
    extension,
    title: input.title ?? null,
    estimatedFileSize: input.estimatedFileSize ?? null,
    detectionSource: input.detectionSource,
    streamProtocol,
    streamType,
    playlistType:
      resolvedCategory === 'stream' ? 'unknown' : null,
    isLive: false,
    isDrm: false,
    redirectCount: input.redirectCount ?? 0,
    confidenceHint: input.confidenceHint,
    requiresCookies: input.requiresCookies ?? false,
    requiredHeaders: input.requiredHeaders ?? null,
  };
}
