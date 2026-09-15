import type { DetectedMedia, MediaDetectionError } from '../types';

export type DiscoveryBadgeKind =
  | 'live'
  | 'drm'
  | 'encrypted'
  | 'unsupported'
  | 'audio'
  | 'video'
  | 'hls'
  | 'scanning';

export type DiscoveryBadge = {
  kind: DiscoveryBadgeKind;
  label: string;
  tone: 'neutral' | 'accent' | 'warning' | 'danger' | 'success';
};

/**
 * Derive status badges from verified media + detection error.
 * DRM / encrypted streams are marked unsupported for download affordance.
 */
export function resolveDiscoveryBadges(
  media: DetectedMedia,
  error: MediaDetectionError | null,
): DiscoveryBadge[] {
  const badges: DiscoveryBadge[] = [];

  if (media.category === 'video') {
    badges.push({ kind: 'video', label: 'Video', tone: 'accent' });
  } else if (media.category === 'audio') {
    badges.push({ kind: 'audio', label: 'Audio', tone: 'success' });
  } else if (media.container === 'dash' || media.streamType === 'DASH') {
    badges.push({ kind: 'hls', label: 'DASH', tone: 'accent' });
  } else if (media.category === 'stream' || media.container === 'hls') {
    badges.push({ kind: 'hls', label: 'HLS', tone: 'accent' });
  }

  if (media.isLive) {
    badges.push({ kind: 'live', label: 'LIVE', tone: 'danger' });
  }

  if (media.isDrm) {
    badges.push({ kind: 'drm', label: 'DRM', tone: 'warning' });
    badges.push({ kind: 'unsupported', label: 'Unsupported', tone: 'warning' });
  } else if (error?.code === 'encrypted_hls') {
    badges.push({ kind: 'encrypted', label: 'Encrypted', tone: 'warning' });
    badges.push({ kind: 'unsupported', label: 'Unsupported', tone: 'warning' });
  }

  if (media.playlistType === 'master') {
    badges.push({ kind: 'hls', label: 'Master', tone: 'neutral' });
  } else if (media.playlistType === 'media') {
    badges.push({ kind: 'hls', label: 'Media Playlist', tone: 'neutral' });
  }

  return badges;
}

export function isDownloadAffordable(media: DetectedMedia): boolean {
  if (media.isDrm) {
    return false;
  }
  if (media.downloadable === false) {
    return false;
  }
  if (media.container === 'unknown') {
    const mime = (media.mimeType ?? '').toLowerCase();
    if (!mime.startsWith('video/') && !mime.startsWith('audio/')) {
      return false;
    }
  }
  // DASH download engine not implemented — do not offer false-positive affordance.
  // Standalone DASH BaseURL files are rewritten to progressive before this gate.
  if (media.container === 'dash' || media.streamType === 'DASH') {
    return false;
  }
  // Separate adaptive video-only without mux support — block until mux exists.
  if (media.videoOnly && media.hasSeparateAudio) {
    return false;
  }
  if (media.requiresCookies && !media.requiredHeaders?.hasCookies) {
    // Still allow if page session may attach cookies at download time.
  }
  if (media.container === 'hls' || media.category === 'stream') {
    return !media.isLive;
  }
  return true;
}
