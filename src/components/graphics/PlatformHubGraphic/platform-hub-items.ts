import { Download, Globe, Link2 } from 'lucide-react-native';

import {
  DailymotionBrandIcon,
  FacebookBrandIcon,
  InstagramBrandIcon,
  RedditBrandIcon,
  TikTokBrandIcon,
  VimeoBrandIcon,
} from './PlatformBrandIcons';
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

/** Clockwise from top — platforms first (promoted set), then VidoraX capabilities. */
export const PLATFORM_HUB_ITEMS: readonly PlatformHubItem[] = [
  {
    id: 'instagram',
    label: 'Instagram',
    kind: 'platform',
    Icon: InstagramBrandIcon,
    brandColor: '#E1306C',
    ...radialEnter(0),
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    kind: 'platform',
    Icon: TikTokBrandIcon,
    brandColor: '#F8FAFC',
    ...radialEnter(1),
  },
  {
    id: 'facebook',
    label: 'Facebook',
    kind: 'platform',
    Icon: FacebookBrandIcon,
    brandColor: '#1877F2',
    ...radialEnter(2),
  },
  {
    id: 'vimeo',
    label: 'Vimeo',
    kind: 'platform',
    Icon: VimeoBrandIcon,
    brandColor: '#1AB7EA',
    ...radialEnter(3),
  },
  {
    id: 'dailymotion',
    label: 'Dailymotion',
    kind: 'platform',
    Icon: DailymotionBrandIcon,
    brandColor: '#0066DC',
    ...radialEnter(4),
  },
  {
    id: 'reddit',
    label: 'Reddit',
    kind: 'platform',
    Icon: RedditBrandIcon,
    brandColor: '#FF4500',
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
