import CirclePlay from 'lucide-react-native/icons/circle-play';
import Download from 'lucide-react-native/icons/download';
import Film from 'lucide-react-native/icons/film';
import Globe from 'lucide-react-native/icons/globe';
import Library from 'lucide-react-native/icons/library';
import Link2 from 'lucide-react-native/icons/link-2';
import ShieldCheck from 'lucide-react-native/icons/shield-check';
import Users from 'lucide-react-native/icons/users';
import Video from 'lucide-react-native/icons/video';

import type { PlatformHubItem } from './types';

export const PLATFORM_HUB_ICON_COUNT = 9;
export const PLATFORM_HUB_START_ANGLE = -90;
export const PLATFORM_HUB_STEP_ANGLE = 360 / PLATFORM_HUB_ICON_COUNT;
export const PLATFORM_HUB_RADIUS_FACTOR = 0.86;

function radialEnter(index: number, distance = 16) {
  const angleRad = ((PLATFORM_HUB_START_ANGLE + index * PLATFORM_HUB_STEP_ANGLE) * Math.PI) / 180;
  return {
    enterDx: Math.cos(angleRad) * distance,
    enterDy: Math.sin(angleRad) * distance,
  };
}

/**
 * Clockwise from top: generic media themes first, then VidoraX capabilities. No third-party brand artwork
 * (store-review and trademark safety); the browser itself still opens any site.
 */
export const PLATFORM_HUB_ITEMS: readonly PlatformHubItem[] = [
  {
    id: 'video',
    label: 'Video',
    kind: 'platform',
    Icon: Video,
    brandColor: '#EF4444',
    ...radialEnter(0),
  },
  {
    id: 'social',
    label: 'Social',
    kind: 'platform',
    Icon: Users,
    brandColor: '#EC4899',
    ...radialEnter(1),
  },
  {
    id: 'media',
    label: 'Media',
    kind: 'platform',
    Icon: Film,
    brandColor: '#F97316',
    ...radialEnter(2),
  },
  {
    id: 'player',
    label: 'Player',
    kind: 'platform',
    Icon: CirclePlay,
    brandColor: '#F59E0B',
    ...radialEnter(3),
  },
  {
    id: 'library',
    label: 'Library',
    kind: 'platform',
    Icon: Library,
    brandColor: '#8B5CF6',
    ...radialEnter(4),
  },
  {
    id: 'private',
    label: 'Private',
    kind: 'platform',
    Icon: ShieldCheck,
    brandColor: '#14B8A6',
    ...radialEnter(5),
  },
  {
    id: 'browser',
    label: 'Browser',
    kind: 'capability',
    Icon: Globe,
    brandColor: '#E2E8F0',
    ...radialEnter(6),
  },
  {
    id: 'pasteLink',
    label: 'Paste link',
    kind: 'capability',
    Icon: Link2,
    brandColor: '#E2E8F0',
    ...radialEnter(7),
  },
  {
    id: 'download',
    label: 'Download',
    kind: 'capability',
    Icon: Download,
    brandColor: '#E2E8F0',
    ...radialEnter(8),
  },
] as const;
