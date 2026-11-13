import { memo } from 'react';
import { Pressable, View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';

export type PrivateCheckboxProps = {
  checked: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
  testID?: string;
};

/** The "I understand" box of Private's first move — the same look as App Lock setup's acknowledgements. */
export const PrivateCheckbox = memo(function PrivateCheckbox({
  checked,
  onToggle,
  label,
  disabled,
  testID,
}: PrivateCheckboxProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: Boolean(disabled) }}
      accessibilityLabel={label}
      hitSlop={6}
      testID={testID}>
      <Box row rtlRow gap={12} style={{ alignItems: 'flex-start' }}>
        <View
          style={{
            width: 22,
            height: 22,
            marginTop: 1,
            borderRadius: 4,
            borderWidth: 2,
            borderColor: checked ? theme.colors.primary : theme.colors.border,
            backgroundColor: checked ? theme.colors.primary : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          {checked ? <Icon name="check" size={16} color="onPrimary" /> : null}
        </View>
        <Text variant="body" style={{ flex: 1 }}>
          {label}
        </Text>
      </Box>
    </Pressable>
  );
});
