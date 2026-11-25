import { memo, useCallback } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { ds, DsIcon, DsIconButton, DsText, DsThumb } from '@/design';
import type { FileEntry } from '@/files/ui/files-index';
import { useTheme } from '@/hooks/use-theme';
import { useRtl, useTranslation } from '@/localization';

import { fileTypeIcon } from '../utils/file-rows';
import { ListCardCell } from './ListCardCell';

export type FileRowProps = {
  file: FileEntry;
  /** The name shown (F2's Show extensions decides "clip.mp4" or "clip"). */
  name: string;
  /** "size · date". */
  meta: string;
  /** The picture instead of the type icon, when the file has one (F2's Show thumbnails). */
  showThumbnail?: boolean;
  /** The picture's width in dp (F2's Thumbnail size: 40, 56 or 72). */
  thumbnailSize?: number;
  first: boolean;
  last: boolean;
  onPress: (file: FileEntry) => void;
  /** The row's ⋮ (also a long press). */
  onMore?: (file: FileEntry) => void;
  /** F4: off where a long press selects (the list's drag gesture); ⋮ still opens the actions. Default on. */
  longPressOpensMore?: boolean;
  /** F4: TalkBack's "Select" action, which starts selecting with this row. */
  onSelect?: () => void;
  /** F3 Show in folder: the file the user came to see. */
  highlighted?: boolean;
  testID?: string;
};

/**
 * Files F1 · #779: a file of design 26's lists — its thumbnail or its type's icon, the name, "size · date" and ⋮.
 * Shared by the type lists and folder screens (F2–F9 reuse it); always rendered inside a FlatList.
 */
export const FileRow = memo(function FileRow({
  file,
  name,
  meta,
  showThumbnail = true,
  thumbnailSize = 56,
  first,
  last,
  onPress,
  onMore,
  longPressOpensMore = true,
  onSelect,
  highlighted = false,
  testID,
}: FileRowProps) {
  const theme = useTheme();
  const rtl = useRtl();
  const { t } = useTranslation();
  const handlePress = useCallback(() => onPress(file), [file, onPress]);
  const handleMore = useCallback(() => onMore?.(file), [file, onMore]);
  const picture = showThumbnail && file.thumbnailUri ? file.thumbnailUri : null;

  return (
    <ListCardCell first={first} last={last}>
      <Pressable
        testID={testID}
        onPress={handlePress}
        onLongPress={onMore && longPressOpensMore ? handleMore : undefined}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={meta ? `${name}, ${meta}` : name}
        accessibilityHint={onSelect ? `${t('fileManager.fileOpenHint')}. ${t('fileManager.longPressSelectHint')}` : t('fileManager.fileOpenHint')}
        accessibilityActions={onSelect ? [{ name: 'select', label: t('fileManager.selectionOn') }] : undefined}
        onAccessibilityAction={onSelect ? (event) => (event.nativeEvent.actionName === 'select' ? onSelect() : undefined) : undefined}
        style={({ pressed }) => ({
          backgroundColor: pressed ? theme.colors.surfacePressed : highlighted ? theme.colors.accentSoft : 'transparent',
        })}>
        <View
          style={{
            flexDirection: rtl.rowDirection,
            alignItems: 'center',
            gap: ds.space.rowGap,
            minHeight: ds.size.rowMinHeight,
            paddingVertical: picture ? 8 : ds.space.rowPadY,
            paddingStart: ds.space.cardPad,
            paddingEnd: onMore ? 44 : ds.space.cardPad,
          }}>
          {picture ? (
            <DsThumb
              uri={picture}
              kind="video"
              icon={fileTypeIcon(file.type)}
              width={thumbnailSize}
              height={Math.round(thumbnailSize * 0.75)}
            />
          ) : (
            <View
              style={{
                width: ds.size.iconTile,
                height: ds.size.iconTile,
                borderRadius: ds.radius.iconTile,
                backgroundColor: theme.colors.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <DsIcon name={fileTypeIcon(file.type)} size={ds.size.rowIcon} color="primary" strokeWidth={ds.stroke.row} />
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <DsText variant="rowTitle" numberOfLines={1} ellipsizeMode="middle">
              {name}
            </DsText>
            {meta ? (
              <DsText variant="rowSub" numberOfLines={1}>
                {meta}
              </DsText>
            ) : null}
          </View>
        </View>
      </Pressable>
      {onMore ? (
        <View style={{ position: 'absolute', top: 0, bottom: 0, end: 2, justifyContent: 'center' }}>
          <DsIconButton
            variant="plain"
            icon="ellipsis-vertical"
            iconSize={18}
            accessibilityLabel={t('fileManager.rowMore', { name })}
            onPress={handleMore}
            testID={testID ? `${testID}-more` : undefined}
          />
        </View>
      ) : null}
    </ListCardCell>
  );
});
