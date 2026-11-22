import type { DsIconName } from '@/design';
import type { AnalyzePhase } from '@/downloads/analyze/analyze-state-machine';
import type { PlatformPageKind } from '@/media-detection/platform/types';

export type PlatformDisplay = {
  label: string;
  icon: DsIconName;
};

export function resolvePlatformDisplay(
  platform: PlatformPageKind | null | undefined,
): PlatformDisplay {
  switch (platform) {
    case 'tiktok':
      return { label: 'TikTok', icon: 'music' };
    case 'instagram':
      return { label: 'Instagram', icon: 'camera' };
    default:
      return { label: 'Video', icon: 'globe' };
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
