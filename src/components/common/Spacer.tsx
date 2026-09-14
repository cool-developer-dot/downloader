import { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import type { SpacingToken } from '@/theme/spacing';

export type SpacerProps = {
  size?: SpacingToken | number;
  flex?: number;
  horizontal?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export const Spacer = memo(function Spacer({
  size = 16,
  flex,
  horizontal = false,
  style,
  testID,
}: SpacerProps) {
  const theme = useTheme();
  const resolvedSize = typeof size === 'number' ? size : theme.spacing[size];

  return (
    <View
      testID={testID}
      style={[
        flex !== undefined
          ? { flex }
          : horizontal
            ? { width: resolvedSize }
            : { height: resolvedSize },
        style,
      ]}
    />
  );
});
