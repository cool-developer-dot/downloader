import { memo } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';

export type ChipVariant = 'filled' | 'outlined';

export type ChipProps = {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  icon?: IconName;
  variant?: ChipVariant;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export const Chip = memo(function Chip({
  label,
  selected = false,
  disabled = false,
  icon,
  variant = 'filled',
  onPress,
  style,
  testID,
}: ChipProps) {
  const theme = useTheme();

  const backgroundColor =
    variant === 'filled'
      ? selected
        ? theme.colors.primary
        : theme.colors.surface
      : 'transparent';

  const textColor =
    selected && variant === 'filled' ? theme.colors.textOnPrimary : theme.colors.textPrimary;
  const borderColor = selected ? theme.colors.primary : theme.colors.border;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing[8],
          paddingHorizontal: theme.spacing[12],
          paddingVertical: theme.spacing[8],
          borderRadius: theme.radius.full,
          backgroundColor,
          borderWidth: 1,
          borderColor,
        },
        style,
      ]}>
      {icon ? (
        <Icon name={icon} size="sm" color={selected && variant === 'filled' ? 'onPrimary' : 'default'} />
      ) : null}
      <Text variant="label" style={{ color: textColor }}>
        {label}
      </Text>
    </Pressable>
  );
});
