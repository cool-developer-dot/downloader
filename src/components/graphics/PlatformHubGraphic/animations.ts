import { Easing } from 'react-native-reanimated';

import { PLATFORM_HUB_ICON_COUNT } from './platform-hub-items';

export const PLATFORM_HUB_TIMINGS = {
  icons: {
    start: 780,
    stagger: 88,
    duration: 460,
  },
  floatStart: 1650,
  connections: {
    start: 2050,
    stagger: 185,
    duration: 560,
  },
  focus: { delay: 4200, duration: 580 },
} as const;

export const PLATFORM_HUB_EASING = {
  softOut: Easing.out(Easing.cubic),
  softInOut: Easing.inOut(Easing.cubic),
} as const;

export const PLATFORM_HUB_MOTION = {
  floatAmplitudeMin: 2,
  floatAmplitudeMax: 3.2,
  enterScaleFrom: 0.82,
  dimOpacity: 0.9,
} as const;

export const PLATFORM_HUB_CONNECTION = {
  energySize: 5,
  connectionHeight: 1.25,
} as const;

export function getPlatformHubIconEnterDelay(index: number): number {
  return PLATFORM_HUB_TIMINGS.icons.start + index * PLATFORM_HUB_TIMINGS.icons.stagger;
}

export function getPlatformHubConnectionDelay(index: number): number {
  return (
    PLATFORM_HUB_TIMINGS.connections.start +
    index * PLATFORM_HUB_TIMINGS.connections.stagger
  );
}

export { PLATFORM_HUB_ICON_COUNT };
