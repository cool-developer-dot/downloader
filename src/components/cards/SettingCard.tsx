import { memo, type ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon, type IconName } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';

import { Card } from './Card';

export type SettingCardProps = {
  title: string;
  description?: string;
  icon?: IconName;
  value?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityHint?: string;
};

export const SettingCard = memo(function SettingCard({
  title,
  description,
  icon,
  value,
  trailing,
  onPress,
  disabled = false,
  style,
  testID,
  accessibilityHint,
}: SettingCardProps) {
  const isInteractive = Boolean(onPress) && !disabled;

  const content = (
    <Card style={style} testID={testID}>
      <Box row center gap={12} style={disabled ? { opacity: 0.55 } : undefined}>
        {icon ? <Icon name={icon} size="md" color={disabled ? 'disabled' : 'primary'} /> : null}
        <Box flex={1} gap={4}>
          <Text variant="body" color={disabled ? 'textDisabled' : 'textPrimary'}>
            {title}
          </Text>
          {description ? (
            <Text variant="bodySmall" color="textSecondary">
              {description}
            </Text>
          ) : null}
        </Box>
        {value ? (
          <Text variant="bodySmall" color="textSecondary">
            {value}
          </Text>
        ) : null}
        {trailing}
        {isInteractive ? <Icon name="chevron-right" size="sm" color="secondary" /> : null}
      </Box>
    </Card>
  );

  if (!isInteractive) {
    return content;
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}>
      {content}
    </Pressable>
  );
});
