import type { PlatformPageKind } from '@/media-detection/platform/types';
import type { AnalyzePhase } from '@/downloads/analyze/analyze-state-machine';

export type PlatformDisplay = {
  label: string;
  icon: 'music-note' | 'camera-outline' | 'web' | 'play-circle-outline';
};

export function resolvePlatformDisplay(
  platform: PlatformPageKind | null | undefined,
): PlatformDisplay {
  switch (platform) {
    case 'tiktok':
      return { label: 'TikTok', icon: 'music-note' };
    case 'instagram':
      return { label: 'Instagram', icon: 'camera-outline' };
    default:
      return { label: 'Video', icon: 'web' };
  }
}

export function shouldShowAnalyzeSpinner(phase: AnalyzePhase): boolean {
  return (
    phase === 'validating_url' ||
    phase === 'identifying_platform' ||
    phase === 'resolving_page' ||
    phase === 'detecting_media' ||
    phase === 'verifying_media' ||
    phase === 'fetching_metadata' ||
    phase === 'creating_download'
  );
}
