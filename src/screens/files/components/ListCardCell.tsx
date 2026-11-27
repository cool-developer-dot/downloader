import { memo, type ReactNode } from 'react';
import { View } from 'react-native';

import { ds } from '@/design';
import { useTheme } from '@/hooks/use-theme';

export type ListCardCellProps = {
  /** The first row of its card: rounded top corners, no divider above. */
  first: boolean;
  /** The last row of its card: rounded bottom corners. */
  last: boolean;
  children: ReactNode;
};

/**
 * One row of a `DsRowGroup`-looking card inside a `FlatList` (design 26's folder card): the card's white, its hairline
 * edge, the 16 dp corners on the first and last rows, and the 1 dp divider between rows. Lets long lists stay
 * virtualized instead of mapping rows into one card.
 */
export const ListCardCell = memo(function ListCardCell({ first, last, children }: ListCardCellProps) {
  const theme = useTheme();
  const radius = ds.radius.card;
  return (
    <View
      style={{
        backgroundColor: theme.colors.card,
        borderColor: theme.colors.cardBorder,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderTopWidth: first ? 1 : 0,
        borderBottomWidth: last ? 1 : 0,
        borderTopLeftRadius: first ? radius : 0,
        borderTopRightRadius: first ? radius : 0,
        borderBottomLeftRadius: last ? radius : 0,
        borderBottomRightRadius: last ? radius : 0,
        overflow: 'hidden',
      }}>
      {first ? null : <View style={{ height: 1, backgroundColor: theme.colors.divider }} />}
      {children}
    </View>
  );
});
