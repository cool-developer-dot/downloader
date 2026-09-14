import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import * as SplashScreen from 'expo-splash-screen';
import { type PropsWithChildren, useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from '@/components/common/error-boundary';
import { useAppFonts } from '@/hooks/use-app-fonts';
import { useTheme } from '@/hooks/use-theme';
import { LocalizationProvider } from '@/localization';
import { SessionProvider } from '@/navigation/SessionProvider';
import { AppInitializerProvider, useAppInitializerState } from '@/providers/app-initializer-provider';
import { AppPaperProvider } from '@/providers/paper-provider';
import { NavigationThemeProvider } from '@/providers/navigation-theme-provider';
import { QueryProvider } from '@/providers/query-provider';
import { AppStatusBar } from '@/providers/status-bar';
import { resolveStartupBackground } from '@/theme';

/**
 * Keeps the native splash visible until fonts + bootstrap finish.
 * Always renders children so the root navigator mounts on first paint.
 */
function AppLaunchGate({ children }: PropsWithChildren) {
  const { loaded, error } = useAppFonts();
  const { isReady: isAppReady } = useAppInitializerState();
  const isFontsReady = loaded || Boolean(error);
  const isLaunchReady = isFontsReady && isAppReady;

  useEffect(() => {
    if (isLaunchReady) {
      SplashScreen.hideAsync();
    }
  }, [isLaunchReady]);

  return <>{children}</>;
}

function ThemedRootView({ children }: PropsWithChildren) {
  const theme = useTheme();
  // Prefer live store; MMKV-seeded initial state prevents wrong-theme first paint.
  const backgroundColor = theme.colors.background;

  const rootStyle = useMemo(
    () => [styles.root, { backgroundColor }],
    [backgroundColor],
  );

  return <GestureHandlerRootView style={rootStyle}>{children}</GestureHandlerRootView>;
}

export function AppProvider({ children }: PropsWithChildren) {
  return (
    <ThemedRootView>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryProvider>
            <AppInitializerProvider>
              <LocalizationProvider>
                <SessionProvider>
                  <AppLaunchGate>
                    <AppPaperProvider>
                      <NavigationThemeProvider>
                        <BottomSheetModalProvider>
                          <AppStatusBar />
                          {children}
                        </BottomSheetModalProvider>
                      </NavigationThemeProvider>
                    </AppPaperProvider>
                  </AppLaunchGate>
                </SessionProvider>
              </LocalizationProvider>
            </AppInitializerProvider>
          </QueryProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </ThemedRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // Static fallback before first useTheme paint — MMKV-resolved, not forced Light.
    backgroundColor: resolveStartupBackground('light'),
  },
});
