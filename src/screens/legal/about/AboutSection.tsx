import { memo, type PropsWithChildren, type ReactNode } from 'react';
import { View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon, type IconName } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { primaryAlphas } from '@/theme';

import { ABOUT_LAYOUT } from './about.constants';

export type AboutSectionProps = PropsWithChildren<{
  title: string;
  description?: string;
  icon: IconName;
  trailing?: ReactNode;
  testID?: string;
}>;

/**
 * Theme-aware section shell for About — mirrors Settings section language
 * without locking to light-only settingsTokens.
 */
export const AboutSection = memo(function AboutSection({
  title,
  description,
  icon,
  trailing,
  children,
  testID,
}: AboutSectionProps) {
  const theme = useTheme();
  const primary = primaryAlphas(theme.colors.primary);

  return (
    <View
      testID={testID}
      accessibilityLabel={`${title}${description ? `. ${description}` : ''}`}>
      <Box row rtlRow center gap={12} mb={12} style={{ alignItems: 'flex-start' }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: theme.radius.md,
            backgroundColor: primary.subtle,
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
              style={{ letterSpacing: -0.2, color: theme.colors.textPrimary }}>
              {title}
            </Text>
            {trailing}
          </Box>
          {description ? (
            <Text
              variant="caption"
              style={{ lineHeight: 18, color: theme.colors.textSecondary }}>
              {description}
            </Text>
          ) : null}
        </Box>
      </Box>

      <View
        style={[
          {
            backgroundColor: theme.colors.card,
            borderRadius: theme.radius.xl,
            borderWidth: 1,
            borderColor: theme.colors.border,
            paddingHorizontal: ABOUT_LAYOUT.cardPaddingX,
            paddingVertical: ABOUT_LAYOUT.cardPaddingY,
            overflow: 'hidden',
          },
          theme.elevation.sm,
        ]}>
        {children}
      </View>
    </View>
  );
});
