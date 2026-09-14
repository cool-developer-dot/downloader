import { memo, useCallback, useMemo } from 'react';
import {
  Switch as RNSwitch,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export type SwitchProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Premium boolean switch aligned to VidoraX theme tokens.
 * Native Switch owns the gesture — do not wrap it in Pressable.
 */
export const Switch = memo(function Switch({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: SwitchProps) {
  const theme = useTheme();

  const handleValueChange = useCallback(
    (next: boolean) => {
      if (disabled || next === value) {
        return;
      }
      onValueChange(next);
    },
    [disabled, onValueChange, value],
  );

  const trackColor = useMemo(
    () => ({
      false: theme.colors.border,
      true: theme.colors.primary,
    }),
    [theme.colors.border, theme.colors.primary],
  );

  return (
    <View
      pointerEvents="box-none"
      style={[
        {
          minWidth: 44,
          minHeight: 44,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? theme.opacity.disabled : 1,
        },
        style,
      ]}
      testID={testID}>
      <RNSwitch
        value={value}
        onValueChange={handleValueChange}
        disabled={disabled}
        trackColor={trackColor}
        thumbColor={theme.colors.white}
        ios_backgroundColor={theme.colors.border}
        accessibilityRole="switch"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ checked: value, disabled }}
        style={{ transform: [{ scaleX: 0.96 }, { scaleY: 0.96 }] }}
      />
    </View>
  );
});
