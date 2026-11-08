import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { PixelRatio, View, type AccessibilityActionEvent } from 'react-native';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { buildFaviconUrl } from '@/screens/bookmarks/utils/bookmark-format';
import type { BookmarkFolder, OrganizedBookmark } from '@/storage/repositories';

/** Row height that still fits three lines at the phone's font scale (no text cut at 1.3). */
export function bookmarkRowHeight(): number {
  return Math.ceil(76 * Math.max(1, Math.min(2, PixelRatio.getFontScale())));
}

type MoveProps = {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveBy: (delta: -1 | 1) => void;
  onOptions: () => void;
};

function a11yActions(t: (k: 'browserBookmarks.moveUp' | 'browserBookmarks.moveDown' | 'browserBookmarks.moreA11y') => string, p: MoveProps) {
  const list: { name: string; label: string }[] = [{ name: 'longpress', label: t('browserBookmarks.moreA11y') }];
  if (p.canMoveUp) list.push({ name: 'moveUp', label: t('browserBookmarks.moveUp') });
  if (p.canMoveDown) list.push({ name: 'moveDown', label: t('browserBookmarks.moveDown') });
  return list;
}

function onA11yAction(event: AccessibilityActionEvent, p: MoveProps) {
  if (event.nativeEvent.actionName === 'moveUp') p.onMoveBy(-1);
  else if (event.nativeEvent.actionName === 'moveDown') p.onMoveBy(1);
  else if (event.nativeEvent.actionName === 'longpress') p.onOptions();
}

const MoreButton = memo(function MoreButton({ onPress, testID }: { onPress: () => void; testID?: string }) {
  const { t } = useTranslation();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t('browserBookmarks.moreA11y')}
      onPress={onPress}
      style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="dots-vertical" size={20} color="secondary" />
    </Pressable>
  );
});

export const FolderRow = memo(function FolderRow({
  folder,
  onOpen,
  ...move
}: { folder: BookmarkFolder; onOpen: () => void } & MoveProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  return (
    <View style={{ flex: 1, flexDirection: rtl.rowDirection, alignItems: 'center', paddingHorizontal: 12, gap: 8 }}>
      <Pressable
        testID={`bookmark-folder-${folder.id}`}
        accessibilityRole="button"
        accessibilityLabel={t('browserBookmarks.folderA11y', { name: folder.name })}
        accessibilityHint={t('browserBookmarks.folderHint')}
        accessibilityActions={a11yActions(t, move)}
        onAccessibilityAction={(e) => onA11yAction(e, move)}
        onPress={onOpen}
        style={{ flex: 1, minHeight: 48, flexDirection: rtl.rowDirection, alignItems: 'center', gap: 12 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: theme.colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Icon name={folder.id === 'bookmarks-bar' ? 'bookmark-box-multiple-outline' : 'folder-outline'} size={20} color="primary" />
        </View>
        <Text variant="body" numberOfLines={2} style={{ flex: 1 }}>
          {folder.name}
        </Text>
      </Pressable>
      <MoreButton onPress={move.onOptions} testID={`bookmark-folder-more-${folder.id}`} />
    </View>
  );
});

export const BookmarkRow = memo(function BookmarkRow({
  bookmark,
  onOpen,
  ...move
}: { bookmark: OrganizedBookmark; onOpen: () => void } & MoveProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const [faviconFailed, setFaviconFailed] = useState(false);
  const favicon = buildFaviconUrl(bookmark.hostname);
  const second = [bookmark.hostname || bookmark.url, bookmark.note ? bookmark.note.replace(/\s+/g, ' ') : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={{ flex: 1, flexDirection: rtl.rowDirection, alignItems: 'center', paddingHorizontal: 12, gap: 8 }}>
      <Pressable
        testID={`bookmark-row-${bookmark.id}`}
        accessibilityRole="button"
        accessibilityLabel={[bookmark.title, second, bookmark.tags.length ? bookmark.tags.join(', ') : null]
          .filter(Boolean)
          .join('. ')}
        accessibilityHint={t('browserBookmarks.bookmarkHint')}
        accessibilityActions={a11yActions(t, move)}
        onAccessibilityAction={(e) => onA11yAction(e, move)}
        onPress={onOpen}
        style={{ flex: 1, minHeight: 48, flexDirection: rtl.rowDirection, alignItems: 'center', gap: 12 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: theme.colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}>
          {favicon && !faviconFailed ? (
            <Image source={{ uri: favicon }} style={{ width: 20, height: 20 }} onError={() => setFaviconFailed(true)} />
          ) : (
            <Icon name="web" size={20} color="secondary" />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="body" numberOfLines={1}>
            {bookmark.title}
          </Text>
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            {second}
          </Text>
          {bookmark.tags.length ? (
            <Text variant="caption" color="primary" numberOfLines={1}>
              {bookmark.tags.map((tag) => `#${tag}`).join('  ')}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <MoreButton onPress={move.onOptions} testID={`bookmark-more-${bookmark.id}`} />
    </View>
  );
});
