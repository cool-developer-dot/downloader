import { memo, type PropsWithChildren, type ReactNode } from 'react';
import { View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon, type IconName } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';

import { useSettingsTokens } from '../theme/settings-tokens';

export type SettingsSectionProps = PropsWithChildren<{
  title: string;
  description?: string;
  icon: IconName;
  trailing?: ReactNode;
  testID?: string;
}>;

/**
 * Shared Settings section shell — icon, title, description, elevated card body.
 * Designed so new preference rows can be added without redesigning the screen.
 */
export const SettingsSection = memo(function SettingsSection({
  title,
  description,
  icon,
  trailing,
  children,
  testID,
}: SettingsSectionProps) {
  const settingsTokens = useSettingsTokens();
  return (
    <View
      testID={testID}
      accessibilityLabel={`${title}${description ? `. ${description}` : ''}`}>
      <Box row rtlRow center gap={12} mb={12} style={{ alignItems: 'flex-start' }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: settingsTokens.radius.icon,
            backgroundColor: settingsTokens.sectionIconBg,
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 2,
          }}
          accessibilityElementsHidden
          importantForAccessibility="no">
          <Icon name={icon} size="sm" color="primary" />
        </View>
        <Box flex={1} gap={2} style={{ paddingTop: 2 }}>
          <Box row rtlRow center style={{ justifyContent: 'space-between' }} gap={8}>
            <Text
              variant="subtitle"
              accessibilityRole="header"
              style={{
                letterSpacing: -0.2,
                color: settingsTokens.textPrimary,
              }}>
              {title}
            </Text>
            {trailing}
          </Box>
          {description ? (
            <Text
              variant="caption"
              style={{
                lineHeight: 18,
                color: settingsTokens.textSecondary,
              }}>
              {description}
            </Text>
          ) : null}
        </Box>
      </Box>

      <View
        style={[
          {
            backgroundColor: settingsTokens.card,
            borderRadius: settingsTokens.radius.card,
            borderWidth: 1,
            borderColor: settingsTokens.cardBorder,
            paddingHorizontal: settingsTokens.spacing.cardPadding,
            paddingVertical: 6,
            overflow: 'hidden',
          },
          settingsTokens.elevation.card,
        ]}>
        {children}
      </View>
    </View>
  );
});
