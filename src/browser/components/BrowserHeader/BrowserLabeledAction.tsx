import { memo } from 'react';
import { ActivityIndicator } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon, type IconName } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';

import { BROWSER_TOUCH_TARGET } from '@/browser/constants';

export type BrowserLabeledActionProps = {
  icon: IconName;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  active?: boolean;
  testID?: string;
};

/**
 * Compact chrome control with icon + caption for discoverability.
 */
export const BrowserLabeledAction = memo(function BrowserLabeledAction({
  icon,
  label,
  accessibilityLabel,
  onPress,
  disabled = false,
  loading = false,
  active = false,
  testID,
}: BrowserLabeledActionProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;
  const captionColor = active ? 'primary' : 'textSecondary';

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: isDisabled, selected: active, busy: loading }}
      hitSlop={2}
      style={{
        minWidth: BROWSER_TOUCH_TARGET,
        minHeight: BROWSER_TOUCH_TARGET + 10,
        paddingHorizontal: 4,
        paddingVertical: 2,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: isDisabled ? 0.45 : 1,
      }}>
      <Box center gap={2}>
        {loading ? (
          <ActivityIndicator size="small" color={theme.colors.primary} />
        ) : (
          <Icon name={icon} size="md" color={active ? 'primary' : 'default'} />
        )}
        <Text
          variant="caption"
          color={captionColor}
          numberOfLines={1}
          style={{
            fontSize: 10,
            lineHeight: 12,
            fontWeight: '600',
            letterSpacing: 0.2,
            maxWidth: 56,
            textAlign: 'center',
          }}>
          {label}
        </Text>
      </Box>
    </Pressable>
  );
});
