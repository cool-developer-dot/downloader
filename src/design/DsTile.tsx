import { memo, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { useTheme } from '@/hooks/use-theme';
import { useRtl } from '@/localization';

import { DsIcon, type DsIconName } from './DsIcon';
import { DsText } from './DsText';
import { ds } from './tokens';

export type DsTileProps = {
  icon?: DsIconName;
  /** Any element in the icon's place (a tab preview, a letter badge). */
  leading?: ReactNode;
  label: string;
  /** Lines the label may wrap to (the Player's "Frame by / frame"); the row grows with it. Default 1. */
  labelLines?: number;
  /** A small glyph after the label (the tabs screen's pin / speaker / moon). */
  badge?: DsIconName;
  onPress?: () => void;
  onLongPress?: () => void;
  selected?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** The design's 70 dp white tile: a 21 dp red stroke icon over a 12.5 dp semibold label (Quick Access, Utilities, Tabs). */
export const DsTile = memo(function DsTile({
  icon,
  leading,
  label,
  labelLines = 1,
  badge,
  onPress,
  onLongPress,
  selected = false,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: DsTileProps) {
  const theme = useTheme();
  const rtl = useRtl();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        {
          flex: 1,
          minHeight: ds.size.tile,
          borderRadius: ds.radius.tile,
          borderWidth: 1,
          borderColor: selected ? theme.colors.primary : theme.colors.cardBorder,
          backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.card,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 6,
          paddingVertical: 10,
          gap: 7,
        },
        style,
      ]}>
      {leading ?? (icon ? <DsIcon name={icon} size={ds.size.tileIcon} color="primary" strokeWidth={ds.stroke.tile} /> : null)}
      <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 4 }}>
        <DsText variant="tile" numberOfLines={labelLines} align="center" style={labelLines > 1 ? { flexShrink: 1 } : undefined}>
          {label}
        </DsText>
        {badge ? <DsIcon name={badge} size={13} color="textPrimary" strokeWidth={1.8} /> : null}
      </View>
    </Pressable>
  );
});

export type DsTileGridProps = {
  children: ReactNode[];
  columns?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Tiles in rows of `columns` (3 in the design) with 10 dp gaps; an incomplete last row keeps the tile width. */
export const DsTileGrid = memo(function DsTileGrid({ children, columns = 3, style, testID }: DsTileGridProps) {
  const rtl = useRtl();
  const items = children.filter(Boolean);
  const rows: ReactNode[][] = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }
  return (
    <View testID={testID} style={[{ gap: ds.space.grid }, style]}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={{ flexDirection: rtl.rowDirection, gap: ds.space.grid }}>
          {row}
          {row.length < columns
            ? Array.from({ length: columns - row.length }, (_, i) => <View key={`pad-${i}`} style={{ flex: 1 }} />)
            : null}
        </View>
      ))}
    </View>
  );
});
