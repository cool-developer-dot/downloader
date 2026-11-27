import { memo, useCallback } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { ds, DsIcon, DsIconButton, DsText, DsThumb } from '@/design';
import type { FileEntry } from '@/files/ui/files-index';
import { swatchColor } from '@/files/organize/swatches';
import { tagColorOf } from '@/files/organize/tag-colors';
import { useItemTagsStore, useTagColorsStore } from '@/library/item-organize-store';
import { useTheme } from '@/hooks/use-theme';
import { useRtl, useTranslation } from '@/localization';

import { fileTypeIcon } from '../utils/file-rows';
import { ListCardCell } from './ListCardCell';

const NO_TAGS: readonly string[] = [];
/** F7: at most this many tag chips on a row (then "+n"). */
const MAX_ROW_TAGS = 2;

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
  /** F6 search: the part of `name` that matched, drawn in bold. */
  nameMatch?: { start: number; end: number } | null;
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
  nameMatch,
  testID,
}: FileRowProps) {
  const theme = useTheme();
  const rtl = useRtl();
  const { t } = useTranslation();
  const handlePress = useCallback(() => onPress(file), [file, onPress]);
  // F7 #939 / #977: the file's tags as chips, each with its colour's dot.
  const tags = useItemTagsStore((state) => state.tagsById[file.id] ?? NO_TAGS);
  const tagColors = useTagColorsStore((state) => state.colors);
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
              icon={fileTypeIcon(file.fileType)}
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
              <DsIcon name={fileTypeIcon(file.fileType)} size={ds.size.rowIcon} color="primary" strokeWidth={ds.stroke.row} />
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            {nameMatch && nameMatch.end > nameMatch.start ? (
              <DsText variant="body" color="textPrimary" numberOfLines={1}>
                {name.slice(0, nameMatch.start)}
                <DsText variant="bodyStrong" color="primary">
                  {name.slice(nameMatch.start, nameMatch.end)}
                </DsText>
                {name.slice(nameMatch.end)}
              </DsText>
            ) : (
              <DsText variant="rowTitle" numberOfLines={1} ellipsizeMode="middle">
                {name}
              </DsText>
            )}
            {meta ? (
              <DsText variant="rowSub" numberOfLines={1}>
                {meta}
              </DsText>
            ) : null}
            {tags.length > 0 ? (
              <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 6, marginTop: 3 }}>
                {tags.slice(0, MAX_ROW_TAGS).map((tag) => {
                  const color = tagColorOf(tagColors, tag);
                  return (
                    <View
                      key={tag}
                      style={{
                        flexDirection: rtl.rowDirection,
                        alignItems: 'center',
                        gap: 4,
                        paddingHorizontal: 7,
                        height: 18,
                        borderRadius: 9,
                        backgroundColor: theme.colors.accentSoft,
                        maxWidth: 120,
                      }}>
                      {color ? <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: swatchColor(color) }} /> : null}
                      <DsText variant="rowSub" numberOfLines={1} style={{ fontSize: 11, lineHeight: 14 }}>
                        {tag}
                      </DsText>
                    </View>
                  );
                })}
                {tags.length > MAX_ROW_TAGS ? <DsText variant="rowSub">{`+${tags.length - MAX_ROW_TAGS}`}</DsText> : null}
              </View>
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
