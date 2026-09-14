import { Stack } from 'expo-router';
import { useMemo } from 'react';

import { useTheme } from '@/hooks/use-theme';
import {
  authRouteNames,
  authStackScreenOptions,
  createContentStyleOptions,
  createFadeScreenOptions,
} from '@/navigation';
import { resolveIntroColors } from '@/theme';

export default function AuthLayout() {
  const theme = useTheme();
  const introBackground = useMemo(
    () => resolveIntroColors(theme.mode).background,
    [theme.mode],
  );

  const screenOptions = useMemo(
    () => ({
      ...authStackScreenOptions,
      ...createContentStyleOptions(introBackground),
    }),
    [introBackground],
  );

  const fadeOptions = useMemo(() => createFadeScreenOptions(), []);

  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name={authRouteNames.splash} options={fadeOptions} />
      <Stack.Screen name={authRouteNames.onboarding} options={fadeOptions} />
    </Stack>
  );
}
