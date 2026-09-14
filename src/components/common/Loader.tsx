import { memo } from 'react';
import { ActivityIndicator, type ActivityIndicatorProps } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export type LoaderSize = 'small' | 'large';

export type LoaderProps = {
  size?: LoaderSize;
  color?: string;
  accessibilityLabel?: string;
} & Pick<ActivityIndicatorProps, 'testID'>;

export const Loader = memo(function Loader({
  size = 'small',
  color,
  accessibilityLabel = 'Loading',
  testID,
}: LoaderProps) {
  const theme = useTheme();

  return (
    <ActivityIndicator
      testID={testID}
      size={size}
      color={color ?? theme.colors.primary}
      accessibilityLabel={accessibilityLabel}
    />
  );
});
