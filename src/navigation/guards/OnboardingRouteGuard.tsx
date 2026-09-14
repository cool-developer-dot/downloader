import { type PropsWithChildren } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import {
  selectAppInitialized,
  useAppStore,
} from '@/store/app';

/**
 * Startup cinematic route (Splash 2–4).
 *
 * Waits for app init only. Does NOT redirect away when
 * `onboardingComplete` is true — those screens are cold-start splash
 * surfaces, not a one-time first-launch gate.
 */
export function OnboardingRouteGuard({ children }: PropsWithChildren) {
  const theme = useTheme();
  const initialized = useAppStore(selectAppInitialized);

  if (!initialized) {
    return (
      <View
        testID="onboarding-route-guard-loading"
        style={{ flex: 1, backgroundColor: theme.colors.background }}
      />
    );
  }

  return children;
}
