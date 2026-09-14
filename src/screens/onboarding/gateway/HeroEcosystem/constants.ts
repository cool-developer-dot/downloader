import type { ComponentType } from 'react';
import { Download, Globe, Link2 } from 'lucide-react-native';

import { resolveOnboardingSurfaces } from '@/theme/onboarding-surfaces';

import {
  DailymotionMonoIcon,
  FacebookMonoIcon,
  InstagramMonoIcon,
  TikTokMonoIcon,
  VimeoMonoIcon,
} from './PlatformMonoIcons';

export type HeroIconRendererProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
};

export type HeroOrbitItemId =
  | 'instagram'
  | 'tiktok'
  | 'facebook'
  | 'vimeo'
  | 'dailymotion'
  | 'browser'
  | 'pasteLink'
  | 'download';

export type HeroOrbitItem = {
  id: HeroOrbitItemId;
  label: string;
  kind: 'platform' | 'capability';
  Icon: ComponentType<HeroIconRendererProps>;
  color: string;
  tint: string;
  border: string;
  enterDx: number;
  enterDy: number;
};

const ICON_COUNT = 8;
const START_ANGLE = -90;
const STEP = 360 / ICON_COUNT;

function radialEnter(index: number, distance = 14): { enterDx: number; enterDy: number } {
  const angleRad = ((START_ANGLE + index * STEP) * Math.PI) / 180;
  return {
    enterDx: Math.cos(angleRad) * distance,
    enterDy: Math.sin(angleRad) * distance,
  };
}

/** Onboarding orbit — no YouTube promotion. */
export const HERO_ORBIT_ITEMS: readonly HeroOrbitItem[] = [
  {
    id: 'instagram',
    label: 'Instagram',
    kind: 'platform',
    Icon: InstagramMonoIcon,
    color: '#E1306C',
    tint: 'rgba(255, 255, 255, 0.04)',
    border: 'rgba(255, 255, 255, 0.14)',
    ...radialEnter(0),
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    kind: 'platform',
    Icon: TikTokMonoIcon,
    color: '#F8FAFC',
    tint: 'rgba(255, 255, 255, 0.04)',
    border: 'rgba(255, 255, 255, 0.14)',
    ...radialEnter(1),
  },
  {
    id: 'facebook',
    label: 'Facebook',
    kind: 'platform',
    Icon: FacebookMonoIcon,
    color: '#1877F2',
    tint: 'rgba(255, 255, 255, 0.04)',
    border: 'rgba(255, 255, 255, 0.14)',
    ...radialEnter(2),
  },
  {
    id: 'vimeo',
    label: 'Vimeo',
    kind: 'platform',
    Icon: VimeoMonoIcon,
    color: '#1AB7EA',
    tint: 'rgba(255, 255, 255, 0.04)',
    border: 'rgba(255, 255, 255, 0.14)',
    ...radialEnter(3),
  },
  {
    id: 'dailymotion',
    label: 'Dailymotion',
    kind: 'platform',
    Icon: DailymotionMonoIcon,
    color: '#0066DC',
    tint: 'rgba(255, 255, 255, 0.04)',
    border: 'rgba(255, 255, 255, 0.14)',
    ...radialEnter(4),
  },
  {
    id: 'browser',
    label: 'Browser',
    kind: 'capability',
    Icon: Globe,
    color: '#E2E8F0',
    tint: 'rgba(255, 255, 255, 0.04)',
    border: 'rgba(255, 255, 255, 0.14)',
    ...radialEnter(5),
  },
  {
    id: 'pasteLink',
    label: 'Paste link',
    kind: 'capability',
    Icon: Link2,
    color: '#E2E8F0',
    tint: 'rgba(255, 255, 255, 0.04)',
    border: 'rgba(255, 255, 255, 0.14)',
    ...radialEnter(6),
  },
  {
    id: 'download',
    label: 'Download',
    kind: 'capability',
    Icon: Download,
    color: '#E2E8F0',
    tint: 'rgba(255, 255, 255, 0.04)',
    border: 'rgba(255, 255, 255, 0.14)',
    ...radialEnter(7),
  },
] as const;

export const HERO_ICON_COUNT = HERO_ORBIT_ITEMS.length;

export const HERO_ORBIT = {
  startAngleDeg: START_ANGLE,
  stepDeg: STEP,
  radiusFactor: 0.88,
} as const;

const DARK_SURFACES = resolveOnboardingSurfaces('dark');

/** @deprecated Prefer useOnboardingSurfaces(); dark cinematic allowlist only. */
export const HERO_ECOSYSTEM_COLORS = {
  energy: DARK_SURFACES.heroEnergy,
  beam: DARK_SURFACES.heroBeam,
  glassBg: DARK_SURFACES.heroGlassBg,
} as const;

export const HERO_ECOSYSTEM_LAYOUT = {
  containerSize: 50,
  iconSize: 26,
  iconStroke: 2,
  energySize: 5,
  connectionHeight: 1.25,
  edgePadding: 4,
} as const;

export const HERO_ECOSYSTEM_MOTION = {
  floatAmplitudeMin: 2,
  floatAmplitudeMax: 3.4,
  enterScaleFrom: 0.82,
  dimOpacity: 0.9,
} as const;
