import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'expo-router';

import { openPlayer } from '@/navigation/helpers/open-player';
import {
  isLaunchHandedOver,
  isSplashShown,
  markLaunchHandedOver,
  subscribeLaunchHandover,
} from '@/navigation/launch-handover';
import { useAppLockStore } from '@/security/app-lock';

import { playerLog } from './diagnostics';
import { isAppShellRoute } from './external-media';
import { incomingMediaQueue } from './incoming-media.runtime';

/**
 * Opens a file another app sent ("Open with VidoraX") in the Player. Mounted inside AppLockGate in the app layout:
 * the file waits until the launch has handed over (src/navigation/launch-handover.ts) and while App Lock is locked
 * (the warm lock overlays the app), so nothing plays behind the PIN screen.
 */
export function IncomingMediaHost(): null {
  const appLockEnabled = useAppLockStore((s) => s.isEnabled);
  const unlocked = useAppLockStore((s) => s.status !== 'LOCKED');
  // Mounted under the splash too (the router already shows the Browser there): the file waits until the splash or
  // the first-launch pages have handed over, or their own navigation would replace the Player.
  const pathname = usePathname();
  const handedOver = useSyncExternalStore(subscribeLaunchHandover, isLaunchHandedOver, isLaunchHandedOver);
  const shellReady = handedOver && isAppShellRoute(pathname);
  const [arrivals, setArrivals] = useState(0);

  useEffect(() => incomingMediaQueue.subscribe(() => setArrivals((n) => n + 1)), []);

  // A launch that never showed the splash has nothing to wait for.
  useEffect(() => {
    if (handedOver) {
      return;
    }
    const timer = setTimeout(() => {
      if (!isSplashShown()) {
        markLaunchHandedOver();
      }
    }, NO_SPLASH_HANDOVER_MS);
    return () => clearTimeout(timer);
  }, [handedOver]);

  useEffect(() => {
    // After this commit: on a cold start the stack under this host is still mounting its first screen.
    const timer = setTimeout(() => {
      const waiting = incomingMediaQueue.hasPending();
      const mediaId = incomingMediaQueue.takeIfAllowed({ shellReady, appLockEnabled, unlocked });
      if (mediaId) {
        playerLog('player.incoming', { step: 'opened', route: routeSection(pathname) });
        openPlayer(mediaId);
      } else if (waiting) {
        playerLog('player.incoming', {
          step: shellReady ? 'held_for_app_lock' : 'held_for_launch',
          route: routeSection(pathname),
        });
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [appLockEnabled, arrivals, pathname, shellReady, unlocked]);

  return null;
}

/** No splash within this long after the app shell mounted: the launch is treated as handed over. */
const NO_SPLASH_HANDOVER_MS = 5_000;

/** First path segment only, for diagnostics (a player route carries a token). */
function routeSection(pathname: string | null | undefined): string {
  return `/${(pathname ?? '').split('/').filter(Boolean)[0] ?? ''}`;
}
