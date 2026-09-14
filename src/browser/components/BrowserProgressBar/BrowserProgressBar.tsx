import { memo, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import {
  BROWSER_PROGRESS_COMPLETE,
  BROWSER_PROGRESS_FADE_DELAY_MS,
  BROWSER_PROGRESS_FADE_DURATION_MS,
  BROWSER_PROGRESS_HEIGHT,
} from '@/browser/constants';
import { selectIsHome, selectIsLoading, selectProgress, useBrowserStore } from '@/browser/stores';

export type BrowserProgressBarProps = {
  testID?: string;
};

/**
 * Chrome-like page-load progress: thin, monotonic, fade-out on completion.
 */
export const BrowserProgressBar = memo(function BrowserProgressBar({
  testID = 'browser-progress-bar',
}: BrowserProgressBarProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const progress = useBrowserStore(selectProgress);
  const isLoading = useBrowserStore(selectIsLoading);
  const isHome = useBrowserStore(selectIsHome);

  const animatedProgress = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const resetHidden = () => {
      animatedProgress.value = 0;
    };

    if (isHome) {
      opacity.value = withTiming(0, { duration: 120 });
      animatedProgress.value = 0;
      return () => {
        cancelAnimation(animatedProgress);
        cancelAnimation(opacity);
      };
    }

    if (isLoading || (progress > 0 && progress < BROWSER_PROGRESS_COMPLETE)) {
      opacity.value = withTiming(1, {
        duration: 120,
        easing: Easing.out(Easing.quad),
      });
      animatedProgress.value = withTiming(Math.max(progress, 0.02), {
        duration: 160,
        easing: Easing.out(Easing.cubic),
      });
    } else if (progress >= BROWSER_PROGRESS_COMPLETE) {
      animatedProgress.value = withTiming(1, {
        duration: 100,
        easing: Easing.out(Easing.quad),
      });

      hideTimer = setTimeout(() => {
        opacity.value = withTiming(
          0,
          {
            duration: BROWSER_PROGRESS_FADE_DURATION_MS,
            easing: Easing.in(Easing.quad),
          },
          (finished) => {
            if (finished) {
              runOnJS(resetHidden)();
            }
          },
        );
      }, BROWSER_PROGRESS_FADE_DELAY_MS);
    } else {
      opacity.value = withTiming(0, { duration: 120 });
      animatedProgress.value = 0;
    }

    return () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
      }
      cancelAnimation(animatedProgress);
      cancelAnimation(opacity);
    };
  }, [animatedProgress, isHome, isLoading, opacity, progress]);

  const trackStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const fillStyle = useAnimatedStyle(() => ({
    width: `${Math.min(animatedProgress.value, 1) * 100}%`,
  }));

  const active = !isHome && isLoading;
  // Coarse a11y ticks reduce live-region chatter without changing the visual bar.
  const percent = Math.round(Math.min(progress, 1) * 20) * 5;

  return (
    <Animated.View
      testID={testID}
      pointerEvents="none"
      accessibilityRole="progressbar"
      accessibilityLabel={t('browser.pageProgressA11y')}
      accessibilityLiveRegion={active ? 'polite' : 'none'}
      accessibilityValue={{
        min: 0,
        max: 100,
        now: percent,
      }}
      accessibilityElementsHidden={!active && progress < BROWSER_PROGRESS_COMPLETE}
      importantForAccessibility={active ? 'yes' : 'no-hide-descendants'}
      style={[styles.track, { height: BROWSER_PROGRESS_HEIGHT }, trackStyle]}>
      <Animated.View
        style={[
          styles.fill,
          {
            height: BROWSER_PROGRESS_HEIGHT,
            backgroundColor: theme.colors.primary,
          },
          fillStyle,
        ]}
      />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
    zIndex: 3,
  },
  fill: {
    borderRadius: 999,
  },
});
