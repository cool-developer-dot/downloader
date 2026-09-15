import 'react-native-gesture-handler';

import '@/bootstrap/configure-storage';
import '@/global.css';

import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useMemo } from 'react';

import { useTheme } from '@/hooks/use-theme';
import {
  createContentStyleOptions,
  InitialRouteRedirect,
  rootLayoutSettings,
  rootRouteNames,
  rootStackScreenOptions,
} from '@/navigation';
import { AppProvider } from '@/providers/app-provider';
import { useAppInitializerState } from '@/providers/app-initializer-provider';
import { resolveStartupBackground } from '@/theme';

SplashScreen.preventAutoHideAsync();

export const unstable_settings = rootLayoutSettings;

function RootNavigator() {
  const theme = useTheme();
  const { isReady, initialRoute } = useAppInitializerState();

  const screenOptions = useMemo(
    () => ({
      ...rootStackScreenOptions,
      // Theme continuity: hydrated store when ready; MMKV seed before ready.
      ...createContentStyleOptions(
        isReady ? theme.colors.background : resolveStartupBackground(),
      ),
    }),
    [isReady, theme.colors.background],
  );

  return (
    <>
      {isReady && initialRoute ? <InitialRouteRedirect href={initialRoute} /> : null}
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name={rootRouteNames.auth} />
        <Stack.Screen name={rootRouteNames.app} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <AppProvider>
      <RootNavigator />
    </AppProvider>
  );
}
