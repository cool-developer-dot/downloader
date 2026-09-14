import { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export type DividerProps = {
  vertical?: boolean;
  inset?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export const Divider = memo(function Divider({ vertical = false, inset = false, style, testID }: DividerProps) {
  const theme = useTheme();

  return (
    <View
      testID={testID}
      accessibilityRole="none"
      style={[
        vertical
          ? {
              width: 1,
              alignSelf: 'stretch',
              backgroundColor: theme.colors.divider,
              marginVertical: inset ? theme.spacing[8] : 0,
            }
          : {
              height: 1,
              alignSelf: 'stretch',
              backgroundColor: theme.colors.divider,
              marginHorizontal: inset ? theme.spacing[16] : 0,
            },
        style,
      ]}
    />
  );
});
