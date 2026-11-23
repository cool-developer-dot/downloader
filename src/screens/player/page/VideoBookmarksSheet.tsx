import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { DsIconButton, DsRow, DsRowGroup, DsText } from '@/design';
import { useTranslation } from '@/localization';
import { bookmarkLabel, bookmarkTimeLabel, type VideoBookmark } from '@/player/video-bookmarks';

import { PlayerSheetFrame } from './PlayerSheetFrame';

export type VideoBookmarksSheetProps = {
  visible: boolean;
  /** The video's title, under the sheet's. */
  subtitle?: string;
  bookmarks: readonly VideoBookmark[];
  /** The time playing now ("1:23"), for "Add a bookmark at 1:23". */
  nowLabel: string;
  canAdd: boolean;
  onAdd: () => void;
  onJump: (bookmark: VideoBookmark) => void;
  onRename: (bookmark: VideoBookmark) => void;
  onDelete: (bookmark: VideoBookmark) => void;
  onClose: () => void;
};

/**
 * P9 #705: the video's bookmarks, by time. Tap one to jump to it; ✎ renames it, the bin deletes it (after a confirm).
 * "Add a bookmark at …" adds one at the time playing now. In ⋮ → Tools → Bookmarks.
 */
export const VideoBookmarksSheet = memo(function VideoBookmarksSheet({
  visible,
  subtitle,
  bookmarks,
  nowLabel,
  canAdd,
  onAdd,
  onJump,
  onRename,
  onDelete,
  onClose,
}: VideoBookmarksSheetProps) {
  const { t, rtl } = useTranslation();
  return (
    <PlayerSheetFrame
      visible={visible}
      title={t('libraryStats.bookmarks')}
      subtitle={subtitle ?? t('libraryStats.bookmarksSubtitle')}
      onClose={onClose}
      testID="player-bookmarks-sheet">
      <DsRowGroup>
        <DsRow
          icon="plus"
          title={t('libraryStats.addBookmarkHere', { time: nowLabel })}
          onPress={onAdd}
          disabled={!canAdd}
          trailing="none"
          testID="player-bookmarks-add"
        />
      </DsRowGroup>
      {bookmarks.length === 0 ? (
        <DsText variant="rowSub" testID="player-bookmarks-empty">
          {t('libraryStats.bookmarksEmpty')}
        </DsText>
      ) : (
        <DsRowGroup testID="player-bookmarks-list">
          {bookmarks.map((bookmark) => {
            const label = bookmarkLabel(bookmark);
            const time = bookmarkTimeLabel(bookmark);
            // The row jumps; rename and delete are buttons beside it (not inside it), so TalkBack reaches each one.
            return (
              <View key={bookmark.id} style={[styles.entry, { flexDirection: rtl.rowDirection }]}>
                <View style={styles.entryMain}>
                  <DsRow
                    icon="bookmark"
                    title={label}
                    subtitle={bookmark.name ? time : undefined}
                    onPress={() => onJump(bookmark)}
                    accessibilityHint={t('libraryStats.bookmarkJumpHint')}
                    trailing="none"
                    testID={`player-bookmark-${bookmark.id}`}
                  />
                </View>
                <DsIconButton
                  icon="pencil"
                  variant="plain"
                  accessibilityLabel={t('libraryStats.bookmarkRenameA11y', { name: label })}
                  onPress={() => onRename(bookmark)}
                  testID={`player-bookmark-rename-${bookmark.id}`}
                />
                <DsIconButton
                  icon="trash-2"
                  variant="plain"
                  accessibilityLabel={t('libraryStats.bookmarkDeleteA11y', { name: label })}
                  onPress={() => onDelete(bookmark)}
                  testID={`player-bookmark-delete-${bookmark.id}`}
                />
              </View>
            );
          })}
        </DsRowGroup>
      )}
    </PlayerSheetFrame>
  );
});

const styles = StyleSheet.create({
  entry: {
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  entryMain: {
    flex: 1,
    minWidth: 0,
  },
});
