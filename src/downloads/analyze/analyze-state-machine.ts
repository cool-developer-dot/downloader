import type { PlatformPageKind } from '@/media-detection/platform/types';
import type { PendingResolutionStatus } from '@/media-detection/services/pending-media-resolution.service';
import { platformResolutionStatusCopy } from '@/media-detection/services/platform-page-url';

/**
 * Deterministic analyze → download state machine.
 * Single source of truth for Paste Link flow phases.
 */
export type AnalyzePhase =
  | 'idle'
  | 'validating_url'
  | 'identifying_platform'
  | 'resolving_page'
  | 'detecting_media'
  | 'verifying_media'
  | 'fetching_metadata'
  | 'waiting_for_playback'
  | 'ready'
  | 'creating_download'
  | 'downloading'
  | 'empty'
  | 'failed'
  | 'cancelled';

export type AnalyzeFlowKind = 'direct' | 'page' | null;

export type AnalyzeProgressContext = {
  flowKind: AnalyzeFlowKind;
  platform: PlatformPageKind | null;
};

export function isAnalyzeBusy(phase: AnalyzePhase): boolean {
  return (
    phase === 'validating_url' ||
    phase === 'identifying_platform' ||
    phase === 'resolving_page' ||
    phase === 'detecting_media' ||
    phase === 'verifying_media' ||
    phase === 'fetching_metadata'
  );
}

export function isAnalyzeInteractive(phase: AnalyzePhase): boolean {
  return phase === 'idle' || phase === 'failed' || phase === 'cancelled';
}

export function mapPendingStatusToAnalyzePhase(
  status: PendingResolutionStatus,
): AnalyzePhase {
  switch (status) {
    case 'resolving_redirect':
      return 'resolving_page';
    case 'loading_page':
      return 'detecting_media';
    case 'waiting_media':
      return 'detecting_media';
    case 'waiting_playback':
      return 'waiting_for_playback';
    case 'verified':
      return 'fetching_metadata';
    case 'failed':
      return 'failed';
    case 'timeout':
      return 'failed';
    default:
      return 'detecting_media';
  }
}

export function analyzeProgressCopy(
  phase: AnalyzePhase,
  context: AnalyzeProgressContext,
): string {
  const platform = context.platform ?? 'generic';

  switch (phase) {
    case 'validating_url':
      return 'Checking link…';
    case 'identifying_platform':
      if (platform === 'tiktok') {
        return 'Recognizing TikTok link…';
      }
      if (platform === 'instagram') {
        return 'Recognizing Instagram link…';
      }
      return 'Identifying source…';
    case 'resolving_page':
      return platformResolutionStatusCopy(platform, 'resolving');
    case 'detecting_media':
      if (platform === 'tiktok') {
        return 'Analyzing TikTok video…';
      }
      if (platform === 'instagram') {
        return 'Analyzing Instagram Reel…';
      }
      return platformResolutionStatusCopy(platform, 'waiting');
    case 'verifying_media':
      return 'Verifying media…';
    case 'fetching_metadata':
      return 'Reading video details…';
    case 'waiting_for_playback':
      return platformResolutionStatusCopy(platform, 'playback');
    case 'creating_download':
      return 'Starting download…';
    case 'downloading':
      return 'Downloading…';
    default:
      return 'Checking media…';
  }
}

export function analyzeFailureCopy(reason: string | null | undefined): string {
  const normalized = reason?.trim().toLowerCase() ?? '';
  if (normalized.includes('private') || normalized.includes('unavailable')) {
    return 'Video is private or unavailable.';
  }
  if (normalized.includes('expired') || normalized.includes('403')) {
    return 'Video link expired. Try analyzing again.';
  }
  if (normalized.includes('drm') || normalized.includes('encrypted')) {
    return 'Unsupported protected media.';
  }
  if (normalized.includes('no_media') || normalized.includes('timeout')) {
    return 'No video detected yet.';
  }
  if (normalized.includes('verification') || normalized.includes('reject')) {
    return 'Source rejected the download.';
  }
  if (normalized.includes('incomplete')) {
    return 'Download was incomplete.';
  }
  if (reason?.trim()) {
    return reason.trim();
  }
  return 'Could not analyze this link.';
}
