import { memo, useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { errorAlphas, primaryAlphas, withAlpha } from '@/theme/colors';

export type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'error';

export type BadgeProps = {
  label: string | number;
  variant?: BadgeVariant;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export const Badge = memo(function Badge({
  label,
  variant = 'default',
  style,
  testID,
}: BadgeProps) {
  const theme = useTheme();

  const colors = useMemo(() => {
    const primary = primaryAlphas(theme.colors.primary);
    const error = errorAlphas(theme.colors.error);

    switch (variant) {
      case 'primary':
        return { background: primary.strong, text: theme.colors.primaryDark };
      case 'success':
        return {
          background: withAlpha(theme.colors.success, 0.12),
          text: theme.colors.success,
        };
      case 'warning':
        return {
          background: withAlpha(theme.colors.warning, 0.14),
          text: theme.colors.warning,
        };
      case 'error':
        return { background: error.medium, text: theme.colors.error };
      default:
        return {
          background: withAlpha(theme.colors.textSecondary, 0.12),
          text: theme.colors.textSecondary,
        };
    }
  }, [theme.colors, variant]);

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={String(label)}
      style={[
        {
          minWidth: theme.spacing[20],
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: theme.radius.full,
          backgroundColor: colors.background,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}>
      <Text variant="caption" style={{ color: colors.text, letterSpacing: 0.2 }}>
        {label}
      </Text>
    </View>
  );
});
