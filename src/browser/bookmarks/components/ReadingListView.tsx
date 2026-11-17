import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { DsChip, DsChipRow, DsRow, DsRowGroup, DsText } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { bookmarkOrganizerRepository, type ReadingItem } from '@/storage/repositories';

import { bookmarkChanges, change } from '../bookmarks.service';
import { FaviconTile } from './BookmarkRows';

/**
 * B9 #89 — the reading list in the design's row look: Unread / Read chips, then one card of rows (favicon tile,
 * title, host). Swipe a page sideways to mark it read (or unread again); long-press (or the TalkBack actions) offers
 * Mark as read / unread and Remove. Tapping opens the page (B17: the offline copy when there is one).
 */
export const ReadingListView = memo(function ReadingListView({ onOpen }: { onOpen: (url: string) => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const version = useSyncExternalStore(bookmarkChanges.subscribe, bookmarkChanges.getVersion, bookmarkChanges.getVersion);
  const [tab, setTab] = useState<'unread' | 'read'>('unread');
  const [items, setItems] = useState<ReadingItem[]>([]);
  const [options, setOptions] = useState<ReadingItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    void bookmarkOrganizerRepository
      .listReading(tab === 'read')
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch(() => setItems([]));
    return () => {
      cancelled = true;
    };
  }, [tab, version]);

  const toggle = useCallback(
    (item: ReadingItem) => void change(() => bookmarkOrganizerRepository.setRead(item.id, item.readAt == null)),
    [],
  );
  const remove = useCallback((item: ReadingItem) => void change(() => bookmarkOrganizerRepository.removeReading(item.id)), []);

  const optionActions = useMemo((): ActionSheetItem[] => {
    if (!options) return [];
    const read = options.readAt != null;
    return [
      { id: 'toggle', label: read ? t('browserBookmarks.markUnread') : t('browserBookmarks.markRead'), icon: read ? 'email-mark-as-unread' : 'check', onPress: () => toggle(options) },
      { id: 'remove', label: t('browserBookmarks.remove'), icon: 'close', destructive: true, onPress: () => remove(options) },
    ];
  }, [options, remove, t, toggle]);

  return (
    <>
      <DsChipRow testID="reading-tabs">
        <DsChip label={t('browserBookmarks.readingUnread')} selected={tab === 'unread'} onPress={() => setTab('unread')} testID="reading-tab-unread" />
        <DsChip label={t('browserBookmarks.readingRead')} selected={tab === 'read'} onPress={() => setTab('read')} testID="reading-tab-read" />
      </DsChipRow>
      {items.length === 0 ? (
        <DsText variant="body" align="center" style={{ paddingVertical: 24 }}>
          {tab === 'unread' ? t('browserBookmarks.readingEmptyUnread') : t('browserBookmarks.readingEmptyRead')}
        </DsText>
      ) : (
        <DsRowGroup testID="reading-list">
          {items.map((item) => {
            const read = item.readAt != null;
            const action = read ? t('browserBookmarks.markUnread') : t('browserBookmarks.markRead');
            const swipeAction = () => (
              <View style={{ justifyContent: 'center', paddingHorizontal: 20, backgroundColor: theme.colors.primary }}>
                <DsText variant="bodyStrong" color="textOnPrimary">
                  {action}
                </DsText>
              </View>
            );
            return (
              <Swipeable key={item.id} friction={2} renderLeftActions={swipeAction} renderRightActions={swipeAction} onSwipeableOpen={() => toggle(item)}>
                <View style={{ backgroundColor: theme.colors.card }}>
                  <DsRow
                    leading={<FaviconTile hostname={item.hostname} />}
                    title={item.title}
                    subtitle={item.hostname}
                    onPress={() => onOpen(item.offlineUri ?? item.url)}
                    onLongPress={() => setOptions(item)}
                    accessibilityLabel={`${item.title}. ${item.hostname}`}
                    accessibilityHint={t('lightBookmarks.readingItemHint')}
                    testID={`reading-item-${item.id}`}
                  />
                </View>
              </Swipeable>
            );
          })}
        </DsRowGroup>
      )}
      <ActionSheetModal visible={options != null} actions={optionActions} title={options?.title ?? t('lightBookmarks.readingOptions')} onClose={() => setOptions(null)} />
    </>
  );
});
