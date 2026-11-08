import { memo, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { FlatList, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { SegmentedControl } from '@/components/inputs/SegmentedControl';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { bookmarkOrganizerRepository, type ReadingItem } from '@/storage/repositories';

import { bookmarkChanges, change } from '../bookmarks.service';

/**
 * B9 #89 — the reading list: Unread / Read. Swipe a page sideways to mark it read (or unread again); the check
 * button and TalkBack actions do the same, and Remove takes it off. Tapping opens the page. B17 adds offline copies
 * through the repository's `setReadingOfflineCopy` hook.
 */
export const ReadingListView = memo(function ReadingListView({ onOpen }: { onOpen: (url: string) => void }) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const version = useSyncExternalStore(bookmarkChanges.subscribe, bookmarkChanges.getVersion, bookmarkChanges.getVersion);
  const [tab, setTab] = useState<'unread' | 'read'>('unread');
  const [items, setItems] = useState<ReadingItem[]>([]);

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

  const renderItem = ({ item }: { item: ReadingItem }) => {
    const read = item.readAt != null;
    const action = read ? t('browserBookmarks.markUnread') : t('browserBookmarks.markRead');
    const swipeAction = () => (
      <View style={{ justifyContent: 'center', paddingHorizontal: 20, backgroundColor: theme.colors.primary }}>
        <Text variant="label" color="textOnPrimary">
          {action}
        </Text>
      </View>
    );
    return (
      <Swipeable
        friction={2}
        renderLeftActions={swipeAction}
        renderRightActions={swipeAction}
        onSwipeableOpen={() => toggle(item)}>
        <View
          style={{
            minHeight: 64,
            flexDirection: rtl.rowDirection,
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 12,
            backgroundColor: theme.colors.background,
          }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${item.hostname}`}
            accessibilityHint={t('browserBookmarks.swipeHint')}
            accessibilityActions={[{ name: 'toggle', label: action }, { name: 'remove', label: t('browserBookmarks.remove') }]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'toggle') toggle(item);
              else if (event.nativeEvent.actionName === 'remove') remove(item);
            }}
            onPress={() => onOpen(item.offlineUri ?? item.url)}
            testID={`reading-item-${item.id}`}
            style={{ flex: 1, minHeight: 48, justifyContent: 'center', paddingVertical: 8 }}>
            <Text variant="body" numberOfLines={2}>
              {item.title}
            </Text>
            <Text variant="caption" color="textSecondary" numberOfLines={1}>
              {item.hostname}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action}
            onPress={() => toggle(item)}
            testID={`reading-toggle-${item.id}`}
            style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={read ? 'email-mark-as-unread' : 'check'} size={20} color="primary" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('browserBookmarks.remove')}
            onPress={() => remove(item)}
            testID={`reading-remove-${item.id}`}
            style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={20} color="secondary" />
          </Pressable>
        </View>
      </Swipeable>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
        <SegmentedControl
          options={[
            { value: 'unread', label: t('browserBookmarks.readingUnread') },
            { value: 'read', label: t('browserBookmarks.readingRead') },
          ]}
          value={tab}
          onChange={setTab}
          testID="reading-tabs"
        />
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={
          <Text variant="body" color="textSecondary" style={{ padding: 24, textAlign: 'center' }}>
            {tab === 'unread' ? t('browserBookmarks.readingEmptyUnread') : t('browserBookmarks.readingEmptyRead')}
          </Text>
        }
      />
    </View>
  );
});
