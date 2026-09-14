import type { AccessibilityRole, StyleProp, ViewStyle } from 'react-native';

import type { IconColorToken } from '@/components/base/types';
import { Box } from '@/components/base/Box';
import { Icon, type IconName } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { Loader } from '@/components/common/Loader';

import { buttonMetrics, type ButtonSize, type ButtonVariant } from './button-styles';

export type SharedButtonContentProps = {
  title?: string;
  variant: ButtonVariant;
  size: ButtonSize;
  loading?: boolean;
  leftIcon?: IconName;
  rightIcon?: IconName;
  textColor: string;
  iconColor: IconColorToken;
  iconSize: number;
};

export function ButtonContent({
  title,
  size,
  loading,
  leftIcon,
  rightIcon,
  textColor,
  iconColor,
  iconSize,
}: SharedButtonContentProps) {
  const metrics = buttonMetrics[size];

  return (
    <Box row center gap={metrics.gap}>
      {loading ? <Loader size="small" color={textColor} /> : null}
      {!loading && leftIcon ? <Icon name={leftIcon} size={iconSize} color={iconColor} /> : null}
      {title ? (
        <Text variant="button" style={{ color: textColor }}>
          {title}
        </Text>
      ) : null}
      {!loading && rightIcon ? <Icon name={rightIcon} size={iconSize} color={iconColor} /> : null}
    </Box>
  );
}

export type BaseButtonProps = {
  title?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  leftIcon?: IconName;
  rightIcon?: IconName;
  fullWidth?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};
