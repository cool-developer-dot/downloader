import { memo, useCallback, type ReactElement } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { Box } from '@/components/base/Box';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';

export type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
  accessibilityLabel?: string;
};

export type SegmentedControlProps<T extends string> = {
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

function SegmentedControlInner<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  accessibilityLabel = 'Segmented control',
  style,
  testID,
}: SegmentedControlProps<T>): ReactElement {
  const theme = useTheme();

  const handleSelect = useCallback(
    (next: T) => {
      if (disabled || next === value) {
        return;
      }
      onChange(next);
    },
    [disabled, onChange, value],
  );

  return (
    <View
      testID={testID}
      // Do not set accessible on the parent — it collapses child tabs on iOS.
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.colors.border,
          padding: 4,
          minHeight: 44,
        },
        style,
      ]}>
      <Box row style={{ width: '100%' }}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => handleSelect(option.value)}
              disabled={disabled}
              accessibilityRole="tab"
              accessibilityState={{ selected, disabled }}
              accessibilityLabel={option.accessibilityLabel ?? option.label}
              style={{
                flex: 1,
                minHeight: 44,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 8,
                borderRadius: theme.radius.md,
                backgroundColor: selected ? theme.colors.primary : 'transparent',
              }}
              testID={testID ? `${testID}-${option.value}` : undefined}>
              <Text
                variant="label"
                style={{
                  color: selected
                    ? theme.colors.textOnPrimary
                    : theme.colors.textSecondary,
                  letterSpacing: 0.1,
                }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </Box>
    </View>
  );
}

/**
 * Premium segmented control for compact preference choices (e.g. theme).
 */
export const SegmentedControl = memo(SegmentedControlInner) as <T extends string>(
  props: SegmentedControlProps<T>,
) => ReactElement;
