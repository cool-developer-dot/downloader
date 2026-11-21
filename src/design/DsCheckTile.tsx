import { memo } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

import { DsIcon } from './DsIcon';
import { ds } from './tokens';

/** The design's check tile (design 40): the accent tile with a check when chosen, an empty square otherwise. */
export const DsCheckTile = memo(function DsCheckTile({ checked }: { checked: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: ds.size.iconTile,
        height: ds.size.iconTile,
        borderRadius: ds.radius.iconTile,
        backgroundColor: theme.colors.accentSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <DsIcon name={checked ? 'check' : 'square'} size={checked ? ds.size.rowIcon : 14} color="primary" strokeWidth={2} />
    </View>
  );
});
