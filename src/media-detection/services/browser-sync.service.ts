import type { DetectedMedia } from '../types';
import { useMediaDetectionStore } from '../stores';

/**
 * Maps DetectedMedia → local download create metadata shape.
 */
export type FutureDownloadMetadataContract = {
  title: string;
  sourceUrl: string;
  platform: string;
  thumbnailUrl: string;
  fileName: string;
  fileSize: string | number;
  /** Extra client fields for local queue. */
  mimeType: string | null;
  container: string;
  category: string;
  mediaId: string;
  pageUrl: string;
  duration: number | null;
  resolution: string | null;
  confidence: number;
};

export function toFutureDownloadContract(
  media: DetectedMedia,
): FutureDownloadMetadataContract | null {
  const title = media.title?.trim() || deriveTitleFromUrl(media.url);
  const platform = media.platformHint || 'WEB';
  const thumbnailUrl = media.thumbnailUrl || placeholderThumbnail(media);
  const fileName = deriveFileName(media);
  const fileSize = media.estimatedFileSize ?? 0;

  if (!title || !media.url) {
    return null;
  }

  return {
    title: title.slice(0, 255),
    sourceUrl: media.sourceUrl || media.url,
    platform,
    thumbnailUrl,
    fileName,
    fileSize,
    mimeType: media.mimeType,
    container: media.container,
    category: media.category,
    mediaId: media.id,
    pageUrl: media.pageUrl,
    duration: media.duration,
    resolution: media.resolution,
    confidence: media.confidence,
  };
}

function deriveTitleFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.split('/').filter(Boolean).pop();
    return path ? decodeURIComponent(path).slice(0, 255) : 'Detected media';
  } catch {
    return 'Detected media';
  }
}

function deriveFileName(media: DetectedMedia): string {
  try {
    const path = new URL(media.url).pathname.split('/').filter(Boolean).pop();
    if (path && path.includes('.')) {
      return path.slice(0, 180);
    }
  } catch {
    // fall through
  }
  const ext = media.extension || 'bin';
  return `vidorax_${media.id}.${ext}`.slice(0, 180);
}

function placeholderThumbnail(media: DetectedMedia): string {
  // Backend requires a valid http(s) thumbnailUrl.
  try {
    const host = new URL(media.pageUrl || media.url).hostname;
    if (host) {
      return `https://${host}/favicon.ico`;
    }
  } catch {
    // fall through
  }
  return 'https://vidorax.app/favicon.ico';
}

/**
 * Notify browser-adjacent consumers that detection state changed.
 * Currently a no-op pub/sub — reserved for chrome badges in later phases.
 */
type DetectionListener = () => void;
const listeners = new Set<DetectionListener>();

export function subscribeDetectionSync(listener: DetectionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyBrowserDetectionSync(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // never throw into browser
    }
  });
}

export function getDetectedMediaSnapshot(): DetectedMedia[] {
  return useMediaDetectionStore.getState().detectedMedia;
}
