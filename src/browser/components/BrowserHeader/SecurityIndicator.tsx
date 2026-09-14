import { memo, useEffect } from 'react';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/base/Icon';
import { useTheme } from '@/hooks/use-theme';

import { BROWSER_OMNIBOX_FOCUS_DURATION_MS } from '@/browser/constants';
import { selectSecurityLevel, useBrowserStore } from '@/browser/stores';
import type { BrowserSecurityLevel } from '@/browser/types';

export type SecurityIndicatorProps = {
  visible?: boolean;
  testID?: string;
};

function resolveSecurityPresentation(level: BrowserSecurityLevel) {
  switch (level) {
    case 'secure':
      return {
        icon: 'lock' as const,
        label: 'Secure HTTPS connection',
        colorToken: 'success' as const,
      };
    case 'insecure':
      return {
        icon: 'lock-open-variant' as const,
        label: 'Not a secure connection',
        colorToken: 'secondary' as const,
      };
    case 'warning':
      return {
        icon: 'shield-alert-outline' as const,
        label: 'Connection security unknown',
        colorToken: 'warning' as const,
      };
    case 'neutral':
    default:
      return {
        icon: 'earth' as const,
        label: 'Browser home',
        colorToken: 'secondary' as const,
      };
  }
}

export const SecurityIndicator = memo(function SecurityIndicator({
  visible = true,
  testID = 'browser-security-indicator',
}: SecurityIndicatorProps) {
  const theme = useTheme();
  const securityLevel = useBrowserStore(selectSecurityLevel);
  const presentation = resolveSecurityPresentation(securityLevel);
  const progress = useSharedValue(securityLevel === 'secure' ? 1 : 0);
  const opacity = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(securityLevel === 'secure' ? 1 : securityLevel === 'insecure' ? 0.35 : 0.15, {
      duration: BROWSER_OMNIBOX_FOCUS_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress, securityLevel]);

  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, {
      duration: BROWSER_OMNIBOX_FOCUS_DURATION_MS,
      easing: Easing.out(Easing.quad),
    });
  }, [opacity, visible]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: 0.92 + opacity.value * 0.08 }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: progress.value * 0.35,
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [theme.colors.warning, theme.colors.success],
    ),
  }));

  if (!visible) {
    return null;
  }

  return (
    <Animated.View
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={presentation.label}
      style={[{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }, animatedStyle]}>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            width: 22,
            height: 22,
            borderRadius: 11,
          },
          glowStyle,
        ]}
      />
      <Icon name={presentation.icon} size="sm" color={presentation.colorToken} />
    </Animated.View>
  );
});
