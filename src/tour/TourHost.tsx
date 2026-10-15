import { usePathname } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState, Keyboard, View } from 'react-native';

import { selectIsHome, useBrowserStore } from '@/browser/stores';
import { routePaths } from '@/navigation/constants/route-paths';
import { registerBackOwner } from '@/navigation/hooks/back-handler-registry';
import { useAppLockStore } from '@/security/app-lock/app-lock.store';
import { getOnboardingComplete } from '@/storage/mmkv/flags';

import { TourOverlay } from './TourOverlay';
import {
  isIdleBrowserMoment,
  isTourPresentable,
  shouldStartTourNow,
  TOUR_SETTLE_MS,
  TOUR_STEP_IDS,
  type TourMomentInput,
} from './tour-policy';
import { useTourStore } from './tour-store';

/** Above every screen and launch gate: while the tour shows, Back moves through it. */
const TOUR_BACK_PRIORITY = 40;

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    let wasBackground = AppState.currentState !== 'active';
    const subscription = AppState.addEventListener('change', (state) => {
      const isActive = state === 'active';
      setActive(isActive);
      if (isActive && wasBackground) {
        useTourStore.getState().noteLink('app_returned_to_foreground');
      }
      wasBackground = state === 'background';
    });
    return () => subscription.remove();
  }, []);
  return active;
}

function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return visible;
}

/**
 * Runs the first-launch Browser tour: decides when it may start (`tour-policy.ts`) and draws it over the whole app
 * window. Mounted inside the App Lock gate, after every screen, so it is never shown on a cold-locked app and is
 * hidden the moment the app locks, goes to the background or leaves the Browser — it comes back at the same step.
 */
export const TourHost = memo(function TourHost() {
  const pathname = usePathname();
  const appActive = useAppActive();
  const keyboardVisible = useKeyboardVisible();
  const lockStatus = useAppLockStore((s) => s.status);
  const isHome = useBrowserStore(selectIsHome);
  const status = useTourStore((s) => s.status);
  const stepIndex = useTourStore((s) => s.stepIndex);
  const replayRequested = useTourStore((s) => s.replayRequested);
  const seen = useTourStore((s) => s.seen);
  const openOverlays = useTourStore((s) => s.openOverlays);
  const linkDeferred = useTourStore((s) => s.linkDeferred);
  const dispatch = useTourStore((s) => s.dispatch);
  const setPresented = useTourStore((s) => s.setPresented);

  const browserVisible = pathname === routePaths.browser;
  const moment: TourMomentInput = {
    browserVisible,
    appActive,
    appLocked: lockStatus === 'LOCKED',
    keyboardVisible,
    openOverlays,
    linkDeferred,
  };

  // The start page is a calm place again after a link the app was opened with.
  useEffect(() => {
    if (browserVisible && isHome) {
      useTourStore.getState().noteLink('start_page_shown');
    }
  }, [browserVisible, isHome]);

  // Start once the Browser has stayed idle for TOUR_SETTLE_MS (the timer restarts whenever it stops being idle).
  const idle = isIdleBrowserMoment(moment);
  const wantsStart = status !== 'running' && (replayRequested || !seen);
  const momentRef = useRef(moment);
  useEffect(() => {
    momentRef.current = moment;
  });
  useEffect(() => {
    if (!idle || !wantsStart) {
      return undefined;
    }
    const timer = setTimeout(() => {
      const store = useTourStore.getState();
      const start = shouldStartTourNow({
        state: store,
        autoStart: { onboardingComplete: getOnboardingComplete(), seen: store.seen },
        moment: momentRef.current,
        idleForMs: TOUR_SETTLE_MS,
      });
      if (start) {
        store.dispatch({ type: 'start' });
      }
    }, TOUR_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [idle, wantsStart]);

  const presented = status === 'running' && isTourPresentable(moment);
  useEffect(() => {
    setPresented(presented);
  }, [presented, setPresented]);
  useEffect(() => () => setPresented(false), [setPresented]);

  const next = useCallback(() => dispatch({ type: 'next' }), [dispatch]);
  const back = useCallback(() => dispatch({ type: 'back' }), [dispatch]);
  const skip = useCallback(() => dispatch({ type: 'skip' }), [dispatch]);
  const targetMissing = useCallback(() => dispatch({ type: 'target_missing' }), [dispatch]);

  // Android Back: previous step, or close the tour on step 1.
  useEffect(() => {
    if (!presented) {
      return undefined;
    }
    return registerBackOwner(TOUR_BACK_PRIORITY, () => {
      useTourStore.getState().dispatch({ type: 'back' });
      return true;
    });
  }, [presented]);

  if (!presented) {
    return null;
  }
  const step = TOUR_STEP_IDS[stepIndex] ?? TOUR_STEP_IDS[0];
  return (
    <TourOverlay
      step={step}
      stepIndex={stepIndex}
      onNext={next}
      onBack={back}
      onSkip={skip}
      onTargetMissing={targetMissing}
    />
  );
});

/** Hides the app underneath from TalkBack while the tour is on screen, so it reads only the tour. */
export const TourAccessibilityScope = memo(function TourAccessibilityScope({ children }: PropsWithChildren) {
  const presented = useTourStore((s) => s.presented);
  return (
    <View
      style={{ flex: 1 }}
      accessibilityElementsHidden={presented}
      importantForAccessibility={presented ? 'no-hide-descendants' : 'auto'}>
      {children}
    </View>
  );
});
