import { useMemo } from 'react';
import { useSharedValue } from 'react-native-reanimated';

import { PLATFORM_HUB_MOTION } from './animations';
import { PLATFORM_HUB_ITEMS } from './platform-hub-items';
import type { PlatformHubIconAnim } from './types';

/** One orbit icon's shared animation values — hooks must be called per slot. */
export function usePlatformHubIconAnim(index: number): PlatformHubIconAnim {
  const item = PLATFORM_HUB_ITEMS[index]!;

  const opacity = useSharedValue(0);
  const scale = useSharedValue<number>(PLATFORM_HUB_MOTION.enterScaleFrom);
  const enterX = useSharedValue<number>(item.enterDx);
  const enterY = useSharedValue<number>(item.enterDy);
  const floatX = useSharedValue(0);
  const floatY = useSharedValue(0);
  const connection = useSharedValue(0);

  return useMemo(
    () => ({ opacity, scale, enterX, enterY, floatX, floatY, connection }),
    [connection, enterX, enterY, floatX, floatY, opacity, scale],
  );
}

/** All nine orbit slots — explicit hook calls satisfy Rules of Hooks. */
export function usePlatformHubIconAnims(): PlatformHubIconAnim[] {
  const a0 = usePlatformHubIconAnim(0);
  const a1 = usePlatformHubIconAnim(1);
  const a2 = usePlatformHubIconAnim(2);
  const a3 = usePlatformHubIconAnim(3);
  const a4 = usePlatformHubIconAnim(4);
  const a5 = usePlatformHubIconAnim(5);
  const a6 = usePlatformHubIconAnim(6);
  const a7 = usePlatformHubIconAnim(7);
  const a8 = usePlatformHubIconAnim(8);

  return useMemo(
    () => [a0, a1, a2, a3, a4, a5, a6, a7, a8],
    [a0, a1, a2, a3, a4, a5, a6, a7, a8],
  );
}
