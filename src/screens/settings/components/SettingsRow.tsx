import { memo, type ReactNode } from 'react';
import { View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon, type IconName } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTranslation } from '@/localization';
import { useSettingsTokens } from '../theme/settings-tokens';
import { SettingsComingSoonBadge } from './SettingsComingSoonBadge';

export type SettingsRowProps = {
  title: string;
  description?: string;
  icon: IconName;
  /** Read-only synced value preview. */
  value?: string;
  comingSoon?: boolean;
  onPress?: () => void;
  showDivider?: boolean;
  trailing?: ReactNode;
  destructive?: boolean;
  accessibilityHint?: string;
  testID?: string;
};

/**
 * Reusable settings preference row.
 * Supports switches (trailing), navigable rows, and coming-soon placeholders.
 */
export const SettingsRow = memo(function SettingsRow({
  title,
  description,
  icon,
  value,
  comingSoon = false,
  onPress,
  showDivider = true,
  trailing,
  destructive = false,
  accessibilityHint,
  testID,
}: SettingsRowProps) {
  const settingsTokens = useSettingsTokens();
  const { t, rtl } = useTranslation();
  const interactive = Boolean(onPress) && !comingSoon;
  /** Switch / custom control owns accessibility — do not nest labels. */
  const controlTrailing = Boolean(trailing) && !interactive && !comingSoon;

  const content = (
    <Box
      row
      rtlRow
      center
      gap={14}
      py={14}
      style={{
        minHeight: settingsTokens.spacing.rowMinHeight,
        opacity: comingSoon ? 0.92 : 1,
      }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: destructive
            ? settingsTokens.destructiveBg
            : comingSoon
              ? settingsTokens.actionIconBgMuted
              : settingsTokens.actionIconBg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        accessibilityElementsHidden
        importantForAccessibility="no">
        <Icon
          name={icon}
          size="md"
          color={destructive ? 'error' : comingSoon ? 'secondary' : 'primary'}
        />
      </View>

      <Box
        flex={1}
        gap={3}
        importantForAccessibility={controlTrailing ? 'no-hide-descendants' : undefined}>
        <Text
          variant="body"
          style={{
            letterSpacing: -0.2,
            lineHeight: 22,
            color: destructive
              ? settingsTokens.destructiveText
              : settingsTokens.textPrimary,
          }}>
          {title}
        </Text>
        {description ? (
          <Text
            variant="caption"
            style={{ lineHeight: 16, color: settingsTokens.textSecondary }}>
            {description}
          </Text>
        ) : null}
      </Box>

      {value && !comingSoon && !controlTrailing ? (
        <Text
          variant="bodySmall"
          numberOfLines={1}
          style={{
            maxWidth: 96,
            color: settingsTokens.textSecondary,
            textAlign: rtl.textAlign,
          }}>
          {value}
        </Text>
      ) : null}

      {comingSoon ? (
            <Box row rtlRow center gap={8}>
          {value ? (
            <Text
              variant="bodySmall"
              numberOfLines={1}
              style={{
                maxWidth: 72,
                color: settingsTokens.textMuted,
                textAlign: rtl.textAlign,
              }}>
              {value}
            </Text>
          ) : null}
          <SettingsComingSoonBadge />
        </Box>
      ) : null}

      {trailing}

      {interactive && !destructive ? (
        <Icon name={rtl.chevronForward} size="sm" color="secondary" />
      ) : null}
    </Box>
  );

  const a11yLabel = comingSoon
    ? `${title}. ${t('common.comingSoon')}.${value ? ` ${t('settings.currentValue', { value })}` : ''} ${description ?? ''}`
    : value
      ? `${title}: ${value}`
      : title;

  return (
    <View testID={testID}>
      {interactive ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          accessibilityHint={accessibilityHint}
          style={{ minHeight: 44 }}>
          {content}
        </Pressable>
      ) : controlTrailing ? (
        <View style={{ minHeight: 44 }}>{content}</View>
      ) : (
        <View
          accessible
          accessibilityRole="text"
          accessibilityLabel={a11yLabel}
          accessibilityState={{ disabled: comingSoon }}>
          {content}
        </View>
      )}
      {showDivider ? (
        <View
          style={{
            height: 1,
            ... (rtl.isRtl ? { marginRight: 54 } : { marginLeft: 54 }),
            backgroundColor: settingsTokens.divider,
          }}
          accessibilityRole="none"
        />
      ) : null}
    </View>
  );
});
