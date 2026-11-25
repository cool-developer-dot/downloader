import { memo, useCallback } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { ds, DsIcon, DsIconButton, DsText, type DsIconName } from '@/design';
import type { FolderEntry } from '@/files/ui/files-index';
import { useTheme } from '@/hooks/use-theme';
import { useRtl, useTranslation } from '@/localization';

import { ListCardCell } from './ListCardCell';

export type FolderRowProps = {
  folder: FolderEntry;
  /** "{n} items · {size}". */
  meta: string;
  first: boolean;
  last: boolean;
  onPress: (folder: FolderEntry) => void;
  /** The folder's ⋮ (also a long press); without it the row ends in a chevron. */
  onMore?: (folder: FolderEntry) => void;
  /** The tile's icon (F10 draws a locked folder with the lock). */
  icon?: DsIconName;
  testID?: string;
};

/**
 * Files F1 · #741: a VidoraX folder as design 26 draws it — the folder tile, the name, "{n} items · {size}", and the
 * chevron (or ⋮ when the folder has actions). Shared by the Files tab and the folder screens; always in a FlatList.
 */
export const FolderRow = memo(function FolderRow({ folder, meta, first, last, onPress, onMore, icon = 'folder', testID }: FolderRowProps) {
  const theme = useTheme();
  const rtl = useRtl();
  const { t } = useTranslation();
  const handlePress = useCallback(() => onPress(folder), [folder, onPress]);
  const handleMore = useCallback(() => onMore?.(folder), [folder, onMore]);

  return (
    <ListCardCell first={first} last={last}>
      <Pressable
        testID={testID}
        onPress={handlePress}
        onLongPress={onMore ? handleMore : undefined}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={meta ? `${folder.name}, ${meta}` : folder.name}
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
            paddingEnd: onMore ? 44 : ds.space.cardPad,
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
            <DsIcon name={icon} size={ds.size.rowIcon} color="primary" strokeWidth={ds.stroke.row} />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <DsText variant="rowTitle" numberOfLines={1}>
              {folder.name}
            </DsText>
            {meta ? (
              <DsText variant="rowSub" numberOfLines={1}>
                {meta}
              </DsText>
            ) : null}
          </View>
          {onMore ? null : (
            <DsIcon name={rtl.isRtl ? 'chevron-left' : 'chevron-right'} size={ds.size.rowChevron} color="textSecondary" strokeWidth={1.8} />
          )}
        </View>
      </Pressable>
      {onMore ? (
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
      ) : null}
    </ListCardCell>
  );
});
