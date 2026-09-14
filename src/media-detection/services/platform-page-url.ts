import { describePlatformPage } from '../platform';
import type { PlatformPageKind } from '../platform/types';
import { isSafeMediaUrl } from '../utils';
import { isShareOrShortLink } from './page-url.resolver';

/**
 * True when a pasted URL is a social PAGE URL — not a direct media file.
 * These must go through Browser + media-detection, not analyzeMediaUrl on the page URL.
 */
export function requiresPageMediaResolution(url: string): boolean {
  const trimmed = url.trim();
  if (!isSafeMediaUrl(trimmed)) {
    return false;
  }

  const platform = describePlatformPage(trimmed);
  if (platform.kind === 'tiktok' || platform.kind === 'instagram') {
    return true;
  }

  return isShareOrShortLink(trimmed);
}

export function classifyPasteInput(url: string): 'direct' | 'page' {
  return requiresPageMediaResolution(url) ? 'page' : 'direct';
}

export function resolvePastePlatformKind(url: string): PlatformPageKind {
  return describePlatformPage(url.trim()).kind;
}

export function platformResolutionStatusCopy(
  platform: PlatformPageKind,
  phase: 'resolving' | 'loading' | 'waiting' | 'playback',
): string {
  switch (phase) {
    case 'resolving':
      if (platform === 'tiktok') {
        return 'Resolving TikTok video…';
      }
      if (platform === 'instagram') {
        return 'Detecting Instagram Reel…';
      }
      return 'Resolving page…';
    case 'loading':
      return 'Opening in Browser…';
    case 'waiting':
      if (platform === 'tiktok') {
        return 'Waiting for TikTok video…';
      }
      if (platform === 'instagram') {
        return 'Waiting for Instagram video…';
      }
      return 'Waiting for media…';
    case 'playback':
      return 'Open and play this video once so VidoraX can detect the media.';
    default:
      return 'Analyzing media…';
  }
}
