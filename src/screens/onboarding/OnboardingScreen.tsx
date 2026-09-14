import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { logOnboardingPersistSnapshot } from '@/bootstrap/onboarding-persist-debug';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { replace, routePaths, useAuthBackHandler } from '@/navigation';
import { useAppStore } from '@/store';
import { awaitOnboardingPersisted } from '@/store/app/persist-sync';
import { resolveIntroColors } from '@/theme';

import { OnboardingFooter } from './components';
import { ONBOARDING_PAGE_COUNT } from './constants';
import { OnboardingSurfacesProvider } from './onboarding-surfaces-context';
import { GatewayScreen } from './gateway';
import { LibraryScreen, type LibraryScreenHandle } from './library';
import { TrustScreen } from './trust';

/**
 * Cold-start cinematic splash pages (Splash 2–4): Gateway → Trust → Library.
 * Surfaces follow selected theme (LIGHT / LOGO / neutral DARK).
 */
export function OnboardingScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const intro = useMemo(() => resolveIntroColors(theme.mode), [theme.mode]);
  const completeOnboarding = useAppStore((state) => state.completeOnboarding);
  const [pageIndex, setPageIndex] = useState(0);
  const [exiting, setExiting] = useState(false);
  const libraryRef = useRef<LibraryScreenHandle>(null);
  const hasFinishedRef = useRef(false);

  useAuthBackHandler();

  const navigateToHome = useCallback(async () => {
    if (hasFinishedRef.current) {
      return;
    }
    hasFinishedRef.current = true;
    completeOnboarding();
    const persisted = await awaitOnboardingPersisted();
    if (__DEV__ && !persisted) {
      console.warn('[onboarding] onboardingComplete was not durably persisted before Browser navigation');
    }
    await logOnboardingPersistSnapshot('onboarding-complete');
    // Phase 1: land on unified Browser (Home tab removed).
    replace(routePaths.browser);
  }, [completeOnboarding]);

  const finish = useCallback(() => {
    if (exiting) {
      return;
    }

    if (pageIndex === ONBOARDING_PAGE_COUNT - 1 && libraryRef.current) {
      setExiting(true);
      libraryRef.current.playExit(navigateToHome);
      return;
    }

    navigateToHome();
  }, [exiting, navigateToHome, pageIndex]);

  const handleSkip = useCallback(() => {
    finish();
  }, [finish]);

  const handleContinue = useCallback(() => {
    if (pageIndex >= ONBOARDING_PAGE_COUNT - 1) {
      finish();
      return;
    }
    setPageIndex((current) => current + 1);
  }, [finish, pageIndex]);

  const footer = (
    <OnboardingFooter
      pageIndex={pageIndex}
      onSkip={handleSkip}
      onContinue={handleContinue}
      continueLabel={
        pageIndex >= ONBOARDING_PAGE_COUNT - 1
          ? t('onboarding.getStarted')
          : t('onboarding.continue')
      }
    />
  );

  return (
    <OnboardingSurfacesProvider>
      <View
        style={[styles.root, { backgroundColor: intro.background }]}
        testID="onboarding-screen">
        {pageIndex === 0 ? (
          <GatewayScreen footer={footer} enabled />
        ) : pageIndex === 1 ? (
          <TrustScreen footer={footer} enabled />
        ) : (
          <LibraryScreen ref={libraryRef} footer={footer} enabled />
        )}
      </View>
    </OnboardingSurfacesProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
