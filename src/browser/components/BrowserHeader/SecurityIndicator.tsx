import { memo, useEffect } from 'react';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { siteInfoRequests } from '@/browser/components/SiteInfo/site-info-requests';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { BROWSER_OMNIBOX_FOCUS_DURATION_MS } from '@/browser/constants';
import { isSecurityFailure } from '@/browser/privacy/https-upgrade';
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
        labelKey: 'browserAddress.security.secure' as const,
        colorToken: 'success' as const,
      };
    case 'insecure':
      return {
        icon: 'lock-open-variant' as const,
        labelKey: 'browserAddress.security.insecure' as const,
        colorToken: 'secondary' as const,
      };
    case 'warning':
      return {
        icon: 'shield-alert-outline' as const,
        labelKey: 'browserAddress.security.unknown' as const,
        colorToken: 'warning' as const,
      };
    case 'neutral':
    default:
      return {
        icon: 'earth' as const,
        labelKey: 'browserAddress.security.home' as const,
        colorToken: 'secondary' as const,
      };
  }
}

export const SecurityIndicator = memo(function SecurityIndicator({
  visible = true,
  testID = 'browser-security-indicator',
}: SecurityIndicatorProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  // B12: an https address whose page failed a security check (certificate, no secure version) isn't secure.
  const securityFailed = useBrowserStore((s) => isSecurityFailure(s.error?.code));
  const storedLevel = useBrowserStore(selectSecurityLevel);
  const securityLevel: BrowserSecurityLevel = securityFailed && storedLevel === 'secure' ? 'insecure' : storedLevel;
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

  // B12: on a web page the lock opens the site information sheet (certificate, cookies, site settings).
  const interactive = securityLevel !== 'neutral';
  const indicator = (
    <Animated.View
      testID={testID}
      accessibilityRole={interactive ? undefined : 'image'}
      accessibilityLabel={interactive ? undefined : t(presentation.labelKey)}
      importantForAccessibility={interactive ? 'no-hide-descendants' : 'auto'}
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

  if (!interactive) {
    return indicator;
  }
  return (
    <Pressable
      onPress={() => siteInfoRequests.open()}
      accessibilityRole="button"
      accessibilityLabel={`${t(presentation.labelKey)}. ${t('browserPrivacy.siteInfoA11y')}`}
      accessibilityHint={t('browserPrivacy.siteInfoHint')}
      hitSlop={10}
      testID={`${testID}-button`}>
      {indicator}
    </Pressable>
  );
});
