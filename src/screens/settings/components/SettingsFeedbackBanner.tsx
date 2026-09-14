import { memo, useMemo } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { errorAlphas, primaryAlphas, withAlpha } from '@/theme';

import { useSettingsTokens } from '../theme/settings-tokens';

export type SettingsFeedbackBannerProps = {
  visible: boolean;
  tone?: 'success' | 'pending' | 'error';
  title: string;
  message: string;
  testID?: string;
};

/**
 * Non-blocking feedback for preference save / local persistence errors.
 */
export const SettingsFeedbackBanner = memo(function SettingsFeedbackBanner({
  visible,
  tone = 'success',
  title,
  message,
  testID = 'settings-feedback-banner',
}: SettingsFeedbackBannerProps) {
  const settingsTokens = useSettingsTokens();
  const theme = useTheme();

  const palette = useMemo(() => {
    const primary = primaryAlphas(theme.colors.primary);
    const error = errorAlphas(theme.colors.error);

    switch (tone) {
      case 'success':
        return {
          background: primary.medium,
          border: primary.emphasis,
          iconBg: withAlpha(theme.colors.primary, 0.14),
          icon: 'check-circle' as const,
          iconColor: 'primary' as const,
        };
      case 'pending':
        return {
          background: withAlpha(theme.colors.warning, 0.12),
          border: withAlpha(theme.colors.warning, 0.22),
          iconBg: withAlpha(theme.colors.warning, 0.16),
          icon: 'save-outline' as const,
          iconColor: 'warning' as const,
        };
      case 'error':
        return {
          background: error.subtle,
          border: error.emphasis,
          iconBg: withAlpha(theme.colors.error, 0.14),
          icon: 'alert-circle-outline' as const,
          iconColor: 'error' as const,
        };
      default:
        return {
          background: primary.medium,
          border: primary.emphasis,
          iconBg: withAlpha(theme.colors.primary, 0.14),
          icon: 'check-circle' as const,
          iconColor: 'primary' as const,
        };
    }
  }, [theme.colors.error, theme.colors.primary, theme.colors.warning, tone]);

  if (!visible) {
    return null;
  }

  return (
    <Animated.View
      entering={FadeInDown.duration(280)}
      exiting={FadeOutUp.duration(200)}
      testID={testID}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      accessibilityLabel={`${title}. ${message}`}
      style={{ marginBottom: 16 }}>
      <View
        style={{
          backgroundColor: palette.background,
          borderRadius: settingsTokens.radius.card,
          borderWidth: 1,
          borderColor: palette.border,
          paddingHorizontal: 16,
          paddingVertical: 14,
        }}>
        <Box row rtlRow gap={12} style={{ alignItems: 'flex-start' }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              backgroundColor: palette.iconBg,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            accessibilityElementsHidden
            importantForAccessibility="no">
            <Icon name={palette.icon} size="md" color={palette.iconColor} />
          </View>
          <Box flex={1} gap={2}>
            <Text
              variant="subtitle"
              style={{
                letterSpacing: -0.2,
                color: settingsTokens.textPrimary,
              }}>
              {title}
            </Text>
            <Text
              variant="caption"
              style={{ lineHeight: 18, color: settingsTokens.textSecondary }}>
              {message}
            </Text>
          </Box>
        </Box>
      </View>
    </Animated.View>
  );
});
