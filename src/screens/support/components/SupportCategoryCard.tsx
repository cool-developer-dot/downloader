import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

export type SupportCategoryCardProps = {
  icon: string;
  title: string;
  description: string;
  selected?: boolean;
  onPress: () => void;
  testID?: string;
};

export const SupportCategoryCard = memo(function SupportCategoryCard({
  icon,
  title,
  description,
  selected = false,
  onPress,
  testID,
}: SupportCategoryCardProps) {
  const theme = useTheme();
  const { rtl } = useTranslation();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={description}
      accessibilityState={{ selected }}
      testID={testID}
      style={{ minHeight: 48 }}>
      <Box
        row
        rtlRow
        center
        gap={12}
        px={14}
        py={14}
        style={{
          minHeight: 48,
          borderRadius: theme.radius.md,
          backgroundColor: selected
            ? `${theme.colors.primary}14`
            : theme.colors.surface,
          borderWidth: 1,
          borderColor: selected ? theme.colors.primary : theme.colors.border,
        }}>
        <Box
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: `${theme.colors.primary}14`,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          accessibilityElementsHidden
          importantForAccessibility="no">
          <Icon name={icon} size="md" color="primary" />
        </Box>
        <Box flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text
            variant="body"
            style={{
              color: theme.colors.textPrimary,
              lineHeight: 22,
              textAlign: rtl.textAlign,
              writingDirection: rtl.writingDirection,
            }}>
            {title}
          </Text>
          <Text
            variant="caption"
            style={{
              color: theme.colors.textSecondary,
              lineHeight: 16,
              textAlign: rtl.textAlign,
              writingDirection: rtl.writingDirection,
            }}>
            {description}
          </Text>
        </Box>
        <Icon name={rtl.chevronForward} size="sm" color="secondary" />
      </Box>
    </Pressable>
  );
});
