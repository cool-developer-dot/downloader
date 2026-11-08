import { memo, useEffect, useState, useSyncExternalStore } from 'react';
import { ScrollView, View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { loadUrlActiveTab } from '@/browser/services';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { bookmarkOrganizerRepository, type OrganizedBookmark } from '@/storage/repositories';
import { useSettingsStore } from '@/store/settings';

import { bookmarkChanges } from '../bookmarks.service';

/**
 * B9 #81 — the bookmarks bar (setting, off by default): the "Bookmarks bar" folder's bookmarks as a sideways strip
 * under the address bar. It lives in the address bar's auto-hiding header, so it hides with it. A tap opens the page in
 * the tab in front.
 */
export const BookmarksBar = memo(function BookmarksBar() {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const enabled = useSettingsStore((s) => s.bookmarksBar === true);
  const version = useSyncExternalStore(bookmarkChanges.subscribe, bookmarkChanges.getVersion, bookmarkChanges.getVersion);
  const [items, setItems] = useState<OrganizedBookmark[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void bookmarkOrganizerRepository
      .listBookmarksBar()
      .then((contents) => {
        if (!cancelled) setItems(contents.bookmarks);
      })
      .catch(() => setItems([]));
    return () => {
      cancelled = true;
    };
  }, [enabled, version]);

  if (!enabled) return null;

  return (
    <View
      testID="bookmarks-bar"
      accessibilityLabel={t('browserBookmarks.bookmarksBar')}
      style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.background }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexDirection: rtl.rowDirection, alignItems: 'center', paddingHorizontal: 8, gap: 4 }}>
        {items.length === 0 ? (
          <Text variant="caption" color="textSecondary" style={{ paddingVertical: 14, paddingHorizontal: 8 }}>
            {t('browserBookmarks.bookmarksBarEmpty')}
          </Text>
        ) : (
          items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="link"
              accessibilityLabel={item.title}
              onPress={() => loadUrlActiveTab(item.url)}
              testID={`bookmarks-bar-${item.id}`}
              style={{ minHeight: 48, maxWidth: 180, justifyContent: 'center', paddingHorizontal: 10 }}>
              <Text variant="label" numberOfLines={1}>
                {item.title}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
});
