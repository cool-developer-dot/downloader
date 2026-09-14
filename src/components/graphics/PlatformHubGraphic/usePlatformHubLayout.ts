import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import {
  PLATFORM_HUB_ICON_COUNT,
  PLATFORM_HUB_ITEMS,
  PLATFORM_HUB_RADIUS_FACTOR,
  PLATFORM_HUB_START_ANGLE,
  PLATFORM_HUB_STEP_ANGLE,
} from './platform-hub-items';
import type { PlatformHubLayoutMetrics } from './types';

export const PLATFORM_HUB_LAYOUT = {
  hero: {
    maxSize: 400,
    widthFactor: 0.92,
    heightFactor: 0.46,
    nodeSize: 52,
    iconSize: 26,
    iconStroke: 2,
    edgePadding: 6,
    centerSize: 96,
    centerGlow: 132,
  },
  compact: {
    maxSize: 320,
    widthFactor: 0.88,
    heightFactor: 0.34,
    nodeSize: 44,
    iconSize: 22,
    iconStroke: 2,
    edgePadding: 4,
    centerSize: 72,
    centerGlow: 96,
  },
} as const;

export function usePlatformHubLayout(variant: 'hero' | 'compact' = 'hero'): PlatformHubLayoutMetrics {
  const { width, height } = useWindowDimensions();
  const spec = PLATFORM_HUB_LAYOUT[variant];

  return useMemo(() => {
    const size = Math.min(width * spec.widthFactor, height * spec.heightFactor, spec.maxSize);
    const half = size / 2;
    const maxOrbitRadius = half - spec.nodeSize / 2 - spec.edgePadding;
    const orbitRadius = maxOrbitRadius * PLATFORM_HUB_RADIUS_FACTOR;

    const positions = PLATFORM_HUB_ITEMS.map((item, index) => {
      const angleDeg = PLATFORM_HUB_START_ANGLE + index * PLATFORM_HUB_STEP_ANGLE;
      const angleRad = (angleDeg * Math.PI) / 180;
      return {
        item,
        index,
        angleDeg,
        angleRad,
        x: Math.cos(angleRad) * orbitRadius,
        y: Math.sin(angleRad) * orbitRadius,
        distance: orbitRadius,
      };
    });

    return { size, orbitRadius, positions };
  }, [height, spec.edgePadding, spec.heightFactor, spec.maxSize, spec.nodeSize, spec.widthFactor, width]);
}

export { PLATFORM_HUB_ICON_COUNT };
