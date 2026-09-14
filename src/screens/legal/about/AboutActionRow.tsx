import { memo, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon, type IconName } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { ABOUT_LAYOUT } from './about.constants';

export type AboutActionRowProps = {
  title: string;
  description?: string;
  icon: IconName;
  value?: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  showDivider?: boolean;
  trailing?: ReactNode;
  accessibilityHint?: string;
  accessibilityLabel?: string;
  testID?: string;
};

/**
 * Theme-aware About action / info row with production a11y and RTL chevrons.
 */
export const AboutActionRow = memo(function AboutActionRow({
  title,
  description,
  icon,
  value,
  onPress,
  disabled = false,
  loading = false,
  showDivider = true,
  trailing,
  accessibilityHint,
  accessibilityLabel,
  testID,
}: AboutActionRowProps) {
  const theme = useTheme();
  const { rtl } = useTranslation();
  const interactive = Boolean(onPress) && !disabled && !loading;

  const content = (
    <Box
      row
      rtlRow
      center
      gap={14}
      py={14}
      style={{
        minHeight: ABOUT_LAYOUT.rowMinHeight,
        opacity: disabled && !loading ? 0.55 : 1,
      }}>
      <View
        style={{
          width: ABOUT_LAYOUT.iconBox,
          height: ABOUT_LAYOUT.iconBox,
          borderRadius: ABOUT_LAYOUT.iconRadius,
          backgroundColor: `${theme.colors.primary}14`,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        accessibilityElementsHidden
        importantForAccessibility="no">
        <Icon name={icon} size="md" color={disabled ? 'secondary' : 'primary'} />
      </View>

      <Box flex={1} gap={3} style={{ minWidth: 0 }}>
        <Text
          variant="body"
          style={{
            letterSpacing: -0.2,
            lineHeight: 22,
            color: theme.colors.textPrimary,
          }}>
          {title}
        </Text>
        {description ? (
          <Text
            variant="caption"
            style={{ lineHeight: 16, color: theme.colors.textSecondary }}>
            {description}
          </Text>
        ) : null}
      </Box>

      {loading ? (
        <ActivityIndicator color={theme.colors.primary} accessibilityElementsHidden />
      ) : null}

      {value && !loading ? (
        <Text
          variant="bodySmall"
          numberOfLines={1}
          style={{
            maxWidth: 120,
            color: theme.colors.textSecondary,
            textAlign: rtl.textAlign,
          }}>
          {value}
        </Text>
      ) : null}

      {trailing}

      {interactive ? (
        <Icon name={rtl.chevronForward} size="sm" color="secondary" />
      ) : null}
    </Box>
  );

  const label =
    accessibilityLabel ??
    (value ? `${title}: ${value}` : description ? `${title}. ${description}` : title);

  return (
    <View testID={testID}>
      {interactive ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={accessibilityHint}
          accessibilityState={{ disabled: false, busy: loading }}
          style={{ minHeight: 44 }}>
          {content}
        </Pressable>
      ) : (
        <View
          accessible
          accessibilityRole={onPress || loading ? 'button' : 'text'}
          accessibilityLabel={label}
          accessibilityHint={accessibilityHint}
          accessibilityState={{ disabled: disabled || loading, busy: loading }}
          style={{ minHeight: 44 }}>
          {content}
        </View>
      )}
      {showDivider ? (
        <View
          style={{
            height: 1,
            ...(rtl.isRtl
              ? { marginRight: ABOUT_LAYOUT.iconBox + 14 }
              : { marginLeft: ABOUT_LAYOUT.iconBox + 14 }),
            backgroundColor: theme.colors.divider,
          }}
          accessibilityRole="none"
        />
      ) : null}
    </View>
  );
});
