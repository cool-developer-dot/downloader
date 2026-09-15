import type { DetectedMedia } from '../types';
import { stableResourcePath } from '../social-source/resource-identity';

/**
 * Merge an incoming detection into an existing list.
 * Matching id → update metadata (prefer non-null / higher confidence).
 * Also collapses same logical media across detectors via canonical URL.
 */
export function dedupeUpsert(
  existing: DetectedMedia[],
  incoming: DetectedMedia,
  maxItems: number,
): { items: DetectedMedia[]; updated: boolean; inserted: boolean } {
  const index = existing.findIndex((item) => item.id === incoming.id);

  if (index >= 0) {
    const prev = existing[index]!;
    const merged = mergeMedia(prev, incoming);
    if (shallowEqualMedia(prev, merged)) {
      return { items: existing, updated: false, inserted: false };
    }
    const next = existing.slice();
    next[index] = merged;
    return { items: next, updated: true, inserted: false };
  }

  // Secondary: same final/source URL + stream family → update.
  const urlIndex = existing.findIndex((item) => isSameLogicalMedia(item, incoming));

  if (urlIndex >= 0) {
    const prev = existing[urlIndex]!;
    const merged = mergeMedia(prev, { ...incoming, id: prev.id });
    if (shallowEqualMedia(prev, merged)) {
      return { items: existing, updated: false, inserted: false };
    }
    const next = existing.slice();
    next[urlIndex] = merged;
    return { items: next, updated: true, inserted: false };
  }

  const next = [incoming, ...existing];
  if (next.length > maxItems) {
    next.length = maxItems;
  }
  return { items: next, updated: false, inserted: true };
}

function isSameLogicalMedia(a: DetectedMedia, b: DetectedMedia): boolean {
  if (a.streamType !== b.streamType && a.category === 'stream' && b.category === 'stream') {
    // Different adaptive protocols are different items.
    if (a.container !== b.container) {
      return false;
    }
  }

  const urlsA = new Set(
    [a.url, a.finalUrl, a.sourceUrl].filter(Boolean).map(stripVolatileQuery),
  );
  const urlsB = [b.url, b.finalUrl, b.sourceUrl].filter(Boolean).map(stripVolatileQuery);

  if (urlsB.some((u) => urlsA.has(u))) {
    return a.container === b.container || a.category === b.category;
  }

  return (
    a.url === b.url &&
    a.container === b.container &&
    a.category === b.category
  );
}

/** Strip common CDN cache-busters for dedup without dropping quality tokens. */
function stripVolatileQuery(url: string): string {
  return stableResourcePath(url) ?? url;
}

function preferNullish<T>(prev: T | null, next: T | null): T | null {
  return next != null ? next : prev;
}

function mergeMedia(prev: DetectedMedia, incoming: DetectedMedia): DetectedMedia {
  const preferIncomingUrl =
    incoming.confidence >= prev.confidence ||
    (incoming.redirectCount > 0 && incoming.finalUrl !== incoming.sourceUrl);

  return {
    ...prev,
    ownerElementIdentity: incoming.ownerElementIdentity ?? prev.ownerElementIdentity,
    frameUrl: incoming.frameUrl ?? prev.frameUrl,
    observedTabId: incoming.observedTabId ?? prev.observedTabId,
    observedNavigationEpoch: incoming.observedNavigationEpoch ?? prev.observedNavigationEpoch,
    observedPageGeneration: incoming.observedPageGeneration ?? prev.observedPageGeneration,
    container: incoming.container !== 'unknown' ? incoming.container : prev.container,
    url: preferIncomingUrl ? incoming.url || prev.url : prev.url,
    sourceUrl: preferNullish(prev.sourceUrl, incoming.sourceUrl) ?? prev.url,
    finalUrl: preferIncomingUrl
      ? incoming.finalUrl || prev.finalUrl
      : prev.finalUrl || incoming.finalUrl,
    pageUrl: incoming.pageUrl || prev.pageUrl,
    title: preferNullish(prev.title, incoming.title),
    thumbnailUrl: preferNullish(prev.thumbnailUrl, incoming.thumbnailUrl),
    duration: preferNullish(prev.duration, incoming.duration),
    width: preferNullish(prev.width, incoming.width),
    height: preferNullish(prev.height, incoming.height),
    resolution: preferNullish(prev.resolution, incoming.resolution),
    aspectRatio: preferNullish(prev.aspectRatio, incoming.aspectRatio),
    fps: preferNullish(prev.fps, incoming.fps),
    estimatedFileSize: preferNullish(
      prev.estimatedFileSize,
      incoming.estimatedFileSize,
    ),
    codec: preferNullish(prev.codec, incoming.codec),
    audioCodec: preferNullish(prev.audioCodec, incoming.audioCodec),
    bitrate: preferNullish(prev.bitrate, incoming.bitrate),
    mimeType: preferNullish(prev.mimeType, incoming.mimeType),
    extension: preferNullish(prev.extension, incoming.extension),
    playlistType: preferNullish(prev.playlistType, incoming.playlistType),
    streamProtocol: preferNullish(prev.streamProtocol, incoming.streamProtocol),
    streamType: incoming.confidence >= prev.confidence ? incoming.streamType : prev.streamType,
    websiteSource: preferNullish(prev.websiteSource, incoming.websiteSource),
    platformHint: preferNullish(prev.platformHint, incoming.platformHint),
    requiredHeaders: preferNullish(prev.requiredHeaders, incoming.requiredHeaders),
    isLive: prev.isLive || incoming.isLive,
    isDrm: prev.isDrm || incoming.isDrm,
    downloadable: prev.isDrm || incoming.isDrm ? false : prev.downloadable || incoming.downloadable,
    requiresCookies: prev.requiresCookies || incoming.requiresCookies,
    redirectCount: Math.max(prev.redirectCount, incoming.redirectCount),
    hasSeparateAudio: prev.hasSeparateAudio || incoming.hasSeparateAudio,
    videoOnly: prev.videoOnly || incoming.videoOnly,
    confidence: Math.max(prev.confidence, incoming.confidence),
    detectionSource:
      incoming.confidence >= prev.confidence
        ? incoming.detectionSource
        : prev.detectionSource,
    sourceDetector:
      incoming.confidence >= prev.confidence
        ? incoming.sourceDetector
        : prev.sourceDetector,
    detectedAt: Math.max(prev.detectedAt, incoming.detectedAt),
  };
}

function shallowEqualMedia(a: DetectedMedia, b: DetectedMedia): boolean {
  return (
    a.ownerElementIdentity === b.ownerElementIdentity &&
    a.frameUrl === b.frameUrl &&
    a.container === b.container &&
    a.title === b.title &&
    a.thumbnailUrl === b.thumbnailUrl &&
    a.duration === b.duration &&
    a.width === b.width &&
    a.height === b.height &&
    a.resolution === b.resolution &&
    a.fps === b.fps &&
    a.estimatedFileSize === b.estimatedFileSize &&
    a.codec === b.codec &&
    a.audioCodec === b.audioCodec &&
    a.bitrate === b.bitrate &&
    a.mimeType === b.mimeType &&
    a.confidence === b.confidence &&
    a.isLive === b.isLive &&
    a.isDrm === b.isDrm &&
    a.playlistType === b.playlistType &&
    a.streamType === b.streamType &&
    a.downloadable === b.downloadable &&
    a.finalUrl === b.finalUrl
  );
}
