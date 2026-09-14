import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import {
  HERO_ECOSYSTEM_LAYOUT,
  HERO_ORBIT,
  HERO_ORBIT_ITEMS,
  type HeroOrbitItem,
} from './constants';

export type HeroOrbitPosition = {
  item: HeroOrbitItem;
  index: number;
  angleDeg: number;
  angleRad: number;
  x: number;
  y: number;
  distance: number;
};

export type HeroOrbitMetrics = {
  size: number;
  orbitRadius: number;
  maxOrbitRadius: number;
  positions: HeroOrbitPosition[];
};

/**
 * Engineered circular orbit:
 * - Equal angular spacing (360° / N)
 * - Single shared radius at 87% of max safe orbit
 * - Logo stays at (0,0) center
 */
export function useHeroOrbitLayout(): HeroOrbitMetrics {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    const size = Math.min(width * 0.88, height * 0.44, 380);
    const half = size / 2;
    const maxOrbitRadius =
      half - HERO_ECOSYSTEM_LAYOUT.containerSize / 2 - HERO_ECOSYSTEM_LAYOUT.edgePadding;
    const orbitRadius = maxOrbitRadius * HERO_ORBIT.radiusFactor;

    const positions = HERO_ORBIT_ITEMS.map((item, index) => {
      const angleDeg = HERO_ORBIT.startAngleDeg + index * HERO_ORBIT.stepDeg;
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

    return { size, orbitRadius, maxOrbitRadius, positions };
  }, [height, width]);
}
