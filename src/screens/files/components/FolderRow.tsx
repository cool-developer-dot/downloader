import { memo, useCallback, useState } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { ds, DsIcon, DsIconButton, DsText, type DsIconName } from '@/design';
import type { FolderEntry } from '@/files/ui/files-index';
import { useLockedNowIds } from '@/files/ui/locked-folders';
import { useTheme } from '@/hooks/use-theme';
import { useRtl, useTranslation } from '@/localization';

import { FolderMenu } from './FolderMenu';
import { ListCardCell } from './ListCardCell';

export type FolderRowProps = {
  folder: FolderEntry;
  /** "{n} items · {size}". */
  meta: string;
  first: boolean;
  last: boolean;
  onPress: (folder: FolderEntry) => void;
  /** The folder's ⋮ (also a long press); without it, ⋮ opens the folder menu (F10: Lock folder / Remove lock). */
  onMore?: (folder: FolderEntry) => void;
  /** The tile's icon (F10 draws a locked folder with the lock). */
  icon?: DsIconName;
  /** F4: off where a long press selects (the list's drag gesture); ⋮ still opens the menu. Default on. */
  longPressOpensMore?: boolean;
  testID?: string;
};

/**
 * Files F1 · #741: a VidoraX folder as design 26 draws it — the folder tile, the name, "{n} items · {size}" and ⋮.
 * Shared by the Files tab and the folder screens; always in a FlatList. F10 #910: a locked folder shows the lock and
 * "Locked" (not its contents' count or size) until it is opened with the PIN, and ⋮ offers Lock folder / Remove lock.
 */
export const FolderRow = memo(function FolderRow({
  folder,
  meta,
  first,
  last,
  onPress,
  onMore,
  icon = 'folder',
  longPressOpensMore = true,
  testID,
}: FolderRowProps) {
  const theme = useTheme();
  const rtl = useRtl();
  const { t } = useTranslation();
  const lockedNow = useLockedNowIds().includes(folder.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const handlePress = useCallback(() => onPress(folder), [folder, onPress]);
  const handleMore = useCallback(() => (onMore ? onMore(folder) : setMenuOpen(true)), [folder, onMore]);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const shownMeta = lockedNow ? t('fileManager.folderLocked') : meta;
  const shownIcon: DsIconName = lockedNow ? 'lock' : icon;

  return (
    <ListCardCell first={first} last={last}>
      <Pressable
        testID={testID}
        onPress={handlePress}
        onLongPress={longPressOpensMore ? handleMore : undefined}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={shownMeta ? `${folder.name}, ${shownMeta}` : folder.name}
        accessibilityHint={t('fileManager.folderOpenHint')}
        style={({ pressed }) => ({ backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent' })}>
        <View
          style={{
            flexDirection: rtl.rowDirection,
            alignItems: 'center',
            gap: ds.space.rowGap,
            minHeight: ds.size.rowMinHeight,
            paddingVertical: ds.space.rowPadY,
            paddingStart: ds.space.cardPad,
            paddingEnd: 44,
          }}>
          <View
            style={{
              width: ds.size.iconTile,
              height: ds.size.iconTile,
              borderRadius: ds.radius.iconTile,
              backgroundColor: theme.colors.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <DsIcon name={shownIcon} size={ds.size.rowIcon} color="primary" strokeWidth={ds.stroke.row} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <DsText variant="rowTitle" numberOfLines={1}>
              {folder.name}
            </DsText>
            {shownMeta ? (
              <DsText variant="rowSub" numberOfLines={1}>
                {shownMeta}
              </DsText>
            ) : null}
          </View>
        </View>
      </Pressable>
      <View style={{ position: 'absolute', top: 0, bottom: 0, end: 2, justifyContent: 'center' }}>
        <DsIconButton
          variant="plain"
          icon="ellipsis-vertical"
          iconSize={18}
          accessibilityLabel={t('fileManager.rowMore', { name: folder.name })}
          onPress={handleMore}
          testID={testID ? `${testID}-more` : undefined}
        />
      </View>
      {onMore ? null : <FolderMenu folder={menuOpen ? folder : null} onClose={closeMenu} />}
    </ListCardCell>
  );
});
