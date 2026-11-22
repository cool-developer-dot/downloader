import { memo, type PropsWithChildren } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

import { ds } from './tokens';

export type DsCardProps = PropsWithChildren<{
  /** 13 dp inner padding (default). `false` for cards made of DsRows, which pad themselves. */
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

/** The design's white card: 16 dp corners, a hairline #EEEDF1 edge, no shadow. */
export const DsCard = memo(function DsCard({ children, padded = true, style, testID }: DsCardProps) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={[
        {
          backgroundColor: theme.colors.card,
          borderRadius: ds.radius.card,
          borderWidth: 1,
          borderColor: theme.colors.cardBorder,
          padding: padded ? ds.space.cardPad : 0,
          overflow: 'hidden',
        },
        style,
      ]}>
      {children}
    </View>
  );
});
