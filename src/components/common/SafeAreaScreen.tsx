import { memo } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';

import { Screen, type ScreenProps } from './Screen';

export type SafeAreaScreenProps = ScreenProps & {
  edges?: ('top' | 'right' | 'bottom' | 'left')[];
  safeAreaStyle?: StyleProp<ViewStyle>;
};

export const SafeAreaScreen = memo(function SafeAreaScreen({
  children,
  edges = ['top', 'right', 'bottom', 'left'],
  safeAreaStyle,
  ...screenProps
}: SafeAreaScreenProps) {
  const theme = useTheme();

  return (
    <SafeAreaView
      edges={edges}
      style={[{ flex: 1, backgroundColor: theme.colors.background }, safeAreaStyle]}>
      <Screen {...screenProps}>{children}</Screen>
    </SafeAreaView>
  );
});
