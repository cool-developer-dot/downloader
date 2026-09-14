import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, StatusBar, View } from 'react-native';
import { router, type Href } from 'expo-router';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolvePostSplashRoute } from '@/navigation/helpers/resolve-post-splash-route';
import { useAuthBackHandler } from '@/navigation/hooks/use-auth-back-handler';
import { logOnboardingPersistSnapshot } from '@/bootstrap/onboarding-persist-debug';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import {
  selectAppInitialized,
  selectAppLoading,
  useAppStore,
} from '@/store/app';
import { resolveIntroColors } from '@/theme';

import { useSplashSequence } from './animations';
import { SPLASH_REDUCED_MOTION, SPLASH_TIMINGS } from './animations/timings';
import { SplashBackground, SplashBrand, SplashLoader, SplashLogo, SplashTagline } from './components';
import { useReducedMotionPreference, useSplashExitGate } from './hooks';
import { createSplashStyles } from './styles';

/**
 * Cinematic branded loader — Splash 1 on every cold process start.
 * Colors follow intro continuity: LIGHT / LOGO / DARK all themed.
 */
export function SplashScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const intro = useMemo(() => resolveIntroColors(theme.mode), [theme.mode]);
  const splashStyles = useMemo(() => createSplashStyles(intro), [intro]);
  useAuthBackHandler();
  const insets = useSafeAreaInsets();
  const hasNavigatedRef = useRef(false);
  const reducedMotion = useReducedMotionPreference();

  const isInitialized = useAppStore(selectAppInitialized);
  const isLoading = useAppStore(selectAppLoading);
  const isInitializationComplete = isInitialized && !isLoading;

  const sequence = useSplashSequence({ reducedMotion });
  const { playExit } = sequence;

  const navigateAway = useCallback(() => {
    if (hasNavigatedRef.current) {
      return;
    }
    hasNavigatedRef.current = true;
    void logOnboardingPersistSnapshot('splash-exit').finally(() => {
      router.replace(resolvePostSplashRoute() as Href);
    });
  }, []);

  const handleReadyToExit = useCallback(() => {
    playExit(navigateAway);
  }, [navigateAway, playExit]);

  useSplashExitGate({
    isInitializationComplete,
    minVisibleMs: reducedMotion
      ? SPLASH_REDUCED_MOTION.minVisibleMs
      : SPLASH_TIMINGS.minVisibleMs + SPLASH_TIMINGS.holdAtComplete,
    onReadyToExit: handleReadyToExit,
  });

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (!cancelled && enabled) {
        AccessibilityInfo.announceForAccessibility('VidoraX is loading');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const contentStyle = useAnimatedStyle(() => ({
    opacity: sequence.contentOpacity.value,
    transform: [
      { translateY: sequence.contentTranslateY.value },
      { scale: sequence.contentScale.value },
    ],
  }));

  return (
    <View
      testID="splash-screen"
      style={splashStyles.root}
      accessibilityLabel={t('splash.loadingScreenA11y')}
      pointerEvents="box-only">
      <StatusBar
        barStyle={intro.statusBarStyle}
        backgroundColor={intro.background}
      />
      <SplashBackground backgroundColor={intro.background} />

      <Animated.View
        style={[
          splashStyles.safeArea,
          contentStyle,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}>
        <View style={splashStyles.stage}>
          <View style={splashStyles.cluster}>
            <SplashLogo opacity={sequence.logoOpacity} scale={sequence.logoScale} />
            <SplashBrand
              letterOpacities={sequence.letterOpacities}
              letterTranslateYs={sequence.letterTranslateYs}
              brandTextColor={intro.brandText}
            />
            <SplashTagline
              wordOpacities={sequence.taglineWordOpacities}
              wordTranslateYs={sequence.taglineWordTranslateYs}
              wordScales={sequence.taglineWordScales}
              taglineTextColor={intro.taglineText}
              taglineDotColor={intro.taglineDot}
            />
            <SplashLoader
              opacity={sequence.loaderOpacity}
              progress={sequence.loaderProgress}
              trackColor={intro.loaderTrack}
              fillColor={intro.loaderFill}
            />
          </View>
        </View>
      </Animated.View>
    </View>
  );
}
