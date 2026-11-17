import { Image } from 'expo-image';
import { memo, useState, type ReactNode } from 'react';
import { PixelRatio, View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { DsIcon, DsText, ds, type DsIconName } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useRtl, useTranslation } from '@/localization';
import { buildFaviconUrl } from '@/screens/bookmarks/utils/bookmark-format';
import type { BookmarkFolder, OrganizedBookmark } from '@/storage/repositories';

/**
 * Design 4 — the rows of the Bookmarks card, in the kit's list-row look (34 dp tile · title / subtitle · chevron).
 * They sit in `SortableRows`, which places rows absolutely, so every row is one fixed height (the design's 58 dp,
 * scaled with the phone's font size) and its text stays on one line — which is why this is not `DsRow` itself.
 */
export function bookmarkRowHeight(): number {
  return Math.ceil(ds.size.rowMinHeight * Math.max(1, Math.min(2, PixelRatio.getFontScale())));
}

/** The 34 dp soft-red tile with a red stroke icon (the kit's row tile). */
export const IconTile = memo(function IconTile({ icon }: { icon: DsIconName }) {
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
      <DsIcon name={icon} size={ds.size.rowIcon} color="primary" strokeWidth={ds.stroke.row} />
    </View>
  );
});

/** The 34 dp tile with the site's icon, or the globe when it has none. */
export const FaviconTile = memo(function FaviconTile({ hostname }: { hostname: string }) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const favicon = buildFaviconUrl(hostname);
  if (!favicon || failed) return <IconTile icon="globe" />;
  return (
    <View
      style={{
        width: ds.size.iconTile,
        height: ds.size.iconTile,
        borderRadius: ds.radius.iconTile,
        backgroundColor: theme.colors.accentSoft,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
      <Image source={{ uri: favicon }} style={{ width: 18, height: 18 }} contentFit="contain" onError={() => setFailed(true)} />
    </View>
  );
});

export type ListRowProps = {
  leading: ReactNode;
  title: string;
  subtitle?: string;
  /** The row's total height; the 1 dp line above it (every row but a card's first) is drawn inside it. */
  height: number;
  divided?: boolean;
  /** Replaces the chevron (a toggle, say). */
  trailing?: ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
};

/** One fixed-height list row with the kit's tokens: tile · one-line title / subtitle · chevron. */
export const ListRow = memo(function ListRow({
  leading,
  title,
  subtitle,
  height,
  divided = false,
  trailing,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ListRowProps) {
  const theme = useTheme();
  const rtl = useRtl();
  return (
    <View style={{ height }}>
      {divided ? <View style={{ height: 1, backgroundColor: theme.colors.divider }} /> : null}
      <Pressable
        testID={testID}
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title)}
        accessibilityHint={accessibilityHint}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: rtl.rowDirection,
          alignItems: 'center',
          gap: ds.space.rowGap,
          paddingHorizontal: ds.space.cardPad,
          backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent',
        })}>
        {leading}
        <View style={{ flex: 1, gap: 1 }}>
          <DsText variant="rowTitle" numberOfLines={1}>
            {title}
          </DsText>
          {subtitle ? (
            <DsText variant="rowSub" numberOfLines={1}>
              {subtitle}
            </DsText>
          ) : null}
        </View>
        {trailing ?? (
          <DsIcon name={rtl.isRtl ? 'chevron-left' : 'chevron-right'} size={ds.size.rowChevron} color="textSecondary" strokeWidth={1.8} />
        )}
      </Pressable>
    </View>
  );
});

type RowProps = { onOpen: () => void; onOptions: () => void; divided?: boolean; height: number };

export const FolderRow = memo(function FolderRow({
  folder,
  itemCount,
  onOpen,
  onOptions,
  divided,
  height,
}: { folder: BookmarkFolder; itemCount: number | null } & RowProps) {
  const { t, tp } = useTranslation();
  return (
    <ListRow
      leading={<IconTile icon={folder.id === 'bookmarks-bar' ? 'star' : 'folder'} />}
      title={folder.name}
      subtitle={itemCount == null ? undefined : tp('plurals.itemsOther', itemCount, { count: itemCount })}
      height={height}
      divided={divided}
      onPress={onOpen}
      onLongPress={onOptions}
      accessibilityLabel={t('browserBookmarks.folderA11y', { name: folder.name })}
      accessibilityHint={t('lightBookmarks.folderOptionsHint')}
      testID={`bookmark-folder-${folder.id}`}
    />
  );
});

export const BookmarkRow = memo(function BookmarkRow({
  bookmark,
  onOpen,
  onOptions,
  divided,
  height,
}: { bookmark: OrganizedBookmark } & RowProps) {
  const { t } = useTranslation();
  const second = [bookmark.hostname || bookmark.url, bookmark.note ? bookmark.note.replace(/\s+/g, ' ') : null]
    .filter(Boolean)
    .join(' · ');
  const tags = bookmark.tags.length ? bookmark.tags.map((tag) => `#${tag}`).join('  ') : '';
  return (
    <ListRow
      leading={<FaviconTile hostname={bookmark.hostname} />}
      title={bookmark.title}
      subtitle={tags ? `${second} · ${tags}` : second}
      height={height}
      divided={divided}
      onPress={onOpen}
      onLongPress={onOptions}
      accessibilityLabel={[bookmark.title, second, bookmark.tags.length ? bookmark.tags.join(', ') : null].filter(Boolean).join('. ')}
      accessibilityHint={t('lightBookmarks.bookmarkOptionsHint')}
      testID={`bookmark-row-${bookmark.id}`}
    />
  );
});
