import { memo } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { ds, DsIcon, DsText, DsThumb, type DsIconName } from '@/design';
import { useTheme } from '@/hooks/use-theme';

export type GridTileProps = {
  title: string;
  meta: string;
  icon: DsIconName;
  /** A thumbnail to show instead of the icon. */
  pictureUri?: string | null;
  width: number;
  onPress: () => void;
  /** A long press: the item's ⋮ menu. */
  onLongPress?: () => void;
  /** F4: set while selecting (true / false); the tile shows its check and a tap toggles it. */
  selected?: boolean;
  accessibilityHint?: string;
  testID?: string;
};

/**
 * Files F2 · #762 Grid view: one file or folder of the grid — the thumbnail (or the type's icon on the soft accent),
 * the name on two lines and the size line. A long press opens its ⋮ menu.
 */
export const GridTile = memo(function GridTile({
  title,
  meta,
  icon,
  pictureUri,
  width,
  onPress,
  onLongPress,
  selected,
  accessibilityHint,
  testID,
}: GridTileProps) {
  const theme = useTheme();
  const pictureHeight = Math.round(width * 0.75);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole={selected === undefined ? 'button' : 'checkbox'}
      accessibilityState={selected === undefined ? undefined : { checked: selected, selected }}
      accessibilityLabel={meta ? `${title}, ${meta}` : title}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => ({
        width,
        borderRadius: ds.radius.tile,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.colors.primary : theme.colors.cardBorder,
        backgroundColor: pressed ? theme.colors.surfacePressed : selected ? theme.colors.accentSoft : theme.colors.card,
        overflow: 'hidden',
      })}>
      {pictureUri ? (
        <DsThumb uri={pictureUri} kind="video" icon={icon} width={width} height={pictureHeight} radius={0} />
      ) : (
        <View style={{ width, height: pictureHeight, backgroundColor: theme.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <DsIcon name={icon} size={Math.min(32, Math.round(width / 3))} color="primary" strokeWidth={ds.stroke.tile} />
        </View>
      )}
      {selected !== undefined ? (
        <View style={{ position: 'absolute', top: 6, start: 6, borderRadius: 4, backgroundColor: theme.colors.card }}>
          <DsIcon name={selected ? 'square-check' : 'square'} size={20} color={selected ? 'primary' : 'textSecondary'} strokeWidth={1.8} />
        </View>
      ) : null}
      <View style={{ paddingHorizontal: 8, paddingVertical: 6, gap: 1 }}>
        <DsText variant="tile" numberOfLines={2}>
          {title}
        </DsText>
        {meta ? (
          <DsText variant="rowSub" numberOfLines={1}>
            {meta}
          </DsText>
        ) : null}
      </View>
    </Pressable>
  );
});
