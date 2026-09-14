import { memo } from 'react';

import { Icon, type IconName } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { useTheme } from '@/hooks/use-theme';
import { icons, spacing } from '@/theme';

export type ToolbarButtonProps = {
  icon: IconName;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
};

/**
 * Browser chrome control: transparent default, semantic nav icon colors,
 * pressed uses bottomNavPressed (not a solid surface square / whole-control fade).
 */
export const ToolbarButton = memo(function ToolbarButton({
  icon,
  accessibilityLabel,
  onPress,
  disabled = false,
  testID,
}: ToolbarButtonProps) {
  const theme = useTheme();
  const size = 44;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      disabledOpacity={1}
      pressedOpacity={1}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: spacing[12],
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor:
          pressed && !disabled ? theme.colors.bottomNavPressed : 'transparent',
      })}>
      <Icon
        name={icon}
        size={icons.md}
        color={disabled ? 'bottomNavInactive' : 'bottomNavActive'}
      />
    </Pressable>
  );
});
