import { type PropsWithChildren, useEffect } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { selectAppInitialized, useAppStore } from '@/store/app';

/**
 * Blocks app routes until local initialization completes.
 * Frozen Phase 2: no account/session gate.
 * While waiting, fill with the active theme background (no wrong-theme flash).
 */
export function ProtectedRouteGuard({ children }: PropsWithChildren) {
  const theme = useTheme();
  const isInitialized = useAppStore(selectAppInitialized);

  useEffect(() => {
    if (!isInitialized) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { setNotificationNavigationReady } = await import(
          '@/downloads/notifications'
        );
        if (!cancelled) {
          setNotificationNavigationReady(true);
        }
      } catch {
        // non-fatal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isInitialized]);

  if (!isInitialized) {
    return (
      <View
        testID="protected-route-guard-loading"
        style={{ flex: 1, backgroundColor: theme.colors.background }}
      />
    );
  }

  return children;
}
