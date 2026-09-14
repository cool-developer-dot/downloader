import { Easing } from 'react-native-reanimated';

import { HERO_ICON_COUNT } from './constants';

export const HERO_ECOSYSTEM_TIMINGS = {
  icons: {
    start: 780,
    stagger: 95,
    duration: 460,
  },
  floatStart: 1650,
  connections: {
    start: 2050,
    stagger: 200,
    duration: 560,
  },
  focus: { delay: 4000, duration: 580 },
} as const;

export const HERO_ECOSYSTEM_EASING = {
  softOut: Easing.out(Easing.cubic),
  softInOut: Easing.inOut(Easing.cubic),
} as const;

export function getHeroIconEnterDelay(index: number): number {
  return HERO_ECOSYSTEM_TIMINGS.icons.start + index * HERO_ECOSYSTEM_TIMINGS.icons.stagger;
}

export function getHeroConnectionDelay(index: number): number {
  return (
    HERO_ECOSYSTEM_TIMINGS.connections.start +
    index * HERO_ECOSYSTEM_TIMINGS.connections.stagger
  );
}

export { HERO_ICON_COUNT };
