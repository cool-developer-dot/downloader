import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { Gesture, type PanGesture } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';
import { useBrowserNavigation } from '@/browser/hooks';
import { pageEdgeSwipesAvailable, SWIPE_EDGE_DP, swipeOutcome } from '@/browser/navigation/swipe-navigation';
import { useTranslation } from '@/localization';
import { useSettingsStore } from '@/store/settings';

/** What the arrow over the page reads (it never writes). */
export type SwipeNavigationShared = {
  /** Finger movement of the swipe in progress (0 when none). */
  dx: SharedValue<number>;
  canGoBack: SharedValue<boolean>;
  canGoForward: SharedValue<boolean>;
};

export type SwipeNavigation = {
  shared: SwipeNavigationShared;
  /** The toolbar's sideways swipe. */
  toolbar: PanGesture;
  /** Swipes that start at the page's left / right edge (button navigation only). */
  leftEdge: PanGesture;
  rightEdge: PanGesture;
};

function readNavigationMode(): string {
  if (!isVidoraWebAvailable()) return 'unknown';
  try {
    return getVidoraWeb().getNavigationMode?.() ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * B6 #45 Swipe navigation: horizontal Pans that go back / forward when released past the trigger (rules:
 * `swipe-navigation.ts`) — on the toolbar always, and from the page edges only with 2- / 3-button navigation (with
 * gesture navigation the system owns the edges; its Back already goes back a page). Vertical movement fails them, so
 * scrolling and taps keep working; when one activates, the touch is taken from the page. Owned by the browser screen,
 * which hands the gestures to the toolbar and the page and the shared values to the arrow.
 */
export function useSwipeNavigation(): SwipeNavigation {
  const { rtl } = useTranslation();
  const settingOn = useSettingsStore((state) => state.swipeNavigation !== false);
  const { canGoBack, canGoForward, isHome, handleBack, handleForward } = useBrowserNavigation();
  const [mode, setMode] = useState(readNavigationMode);
  const dx = useSharedValue(0);
  const backAllowed = useSharedValue(false);
  const forwardAllowed = useSharedValue(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setMode(readNavigationMode());
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    backAllowed.value = canGoBack && !isHome;
    forwardAllowed.value = canGoForward;
  }, [backAllowed, canGoBack, canGoForward, forwardAllowed, isHome]);

  const finish = useCallback(
    (translationX: number, velocityX: number) => {
      const outcome = swipeOutcome({
        dx: translationX,
        vx: velocityX,
        rtl: rtl.isRtl,
        canGoBack: canGoBack && !isHome,
        canGoForward,
      });
      if (outcome === 'back') handleBack();
      else if (outcome === 'forward') handleForward();
    },
    [canGoBack, canGoForward, handleBack, handleForward, isHome, rtl.isRtl],
  );

  const edgesOn = settingOn && pageEdgeSwipesAvailable(mode);

  return useMemo(() => {
    const pan = (enabled: boolean) =>
      Gesture.Pan()
        .enabled(enabled)
        .activeOffsetX([-16, 16])
        .failOffsetY([-14, 14])
        .onUpdate((event) => {
          dx.value = event.translationX;
        })
        .onEnd((event) => {
          runOnJS(finish)(event.translationX, event.velocityX);
        })
        .onFinalize(() => {
          dx.value = withTiming(0, { duration: 160 });
        });
    return {
      shared: { dx, canGoBack: backAllowed, canGoForward: forwardAllowed },
      toolbar: pan(settingOn),
      leftEdge: pan(edgesOn).hitSlop({ left: 0, width: SWIPE_EDGE_DP }),
      rightEdge: pan(edgesOn).hitSlop({ right: 0, width: SWIPE_EDGE_DP }),
    };
  }, [backAllowed, dx, edgesOn, finish, forwardAllowed, settingOn]);
}
