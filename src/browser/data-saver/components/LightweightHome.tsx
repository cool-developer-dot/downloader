import { memo, useEffect, useState, useSyncExternalStore } from 'react';
import { ScrollView, View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { bookmarkChanges } from '@/browser/bookmarks/bookmarks.service';
import { START_PAGE_QUICK_SITES } from '@/browser/config/quick-sites';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { bookmarkOrganizerRepository, type OrganizedBookmark } from '@/storage/repositories';

const MAX_BOOKMARKS = 50;

function Row({ title, url, onOpen, testID }: { title: string; url: string; onOpen: (url: string) => void; testID: string }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={title}
      accessibilityHint={t('browserDataSaver.openHint')}
      onPress={() => onOpen(url)}
      testID={testID}
      style={{ minHeight: 48, justifyContent: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
      <Text variant="body" color="link" numberOfLines={2}>
        {title}
      </Text>
    </Pressable>
  );
}

/**
 * B18 #285 — the lightweight start page: text only (no pictures, icons, backgrounds or animation), Quick Access and the
 * bookmarks in the top folder. Shown when "Lightweight start page" or Lite mode is on.
 */
export const LightweightHome = memo(function LightweightHome({ onOpen }: { onOpen: (url: string) => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const version = useSyncExternalStore(bookmarkChanges.subscribe, bookmarkChanges.getVersion, bookmarkChanges.getVersion);
  const [bookmarks, setBookmarks] = useState<OrganizedBookmark[]>([]);

  useEffect(() => {
    let cancelled = false;
    void bookmarkOrganizerRepository
      .listFolder(null)
      .then((contents) => {
        if (!cancelled) setBookmarks(contents.bookmarks.slice(0, MAX_BOOKMARKS));
      })
      .catch(() => {
        if (!cancelled) setBookmarks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  return (
    <ScrollView
      testID="browser-home-lightweight"
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16, gap: 20 }}
      accessibilityLabel={t('browser.home.startPageA11y')}>
      <View>
        <Text variant="title" accessibilityRole="header">
          {t('browser.home.quickAccess')}
        </Text>
        {START_PAGE_QUICK_SITES.map((site) => (
          <Row key={site.url} title={site.name} url={site.url} onOpen={onOpen} testID={`light-home-site-${site.hostname}`} />
        ))}
      </View>
      <View>
        <Text variant="title" accessibilityRole="header">
          {t('browserDataSaver.homeBookmarks')}
        </Text>
        {bookmarks.length === 0 ? (
          <Text variant="bodySmall" color="textSecondary" style={{ paddingVertical: 8 }}>
            {t('browserDataSaver.homeNoBookmarks')}
          </Text>
        ) : (
          bookmarks.map((bookmark) => (
            <Row key={bookmark.id} title={bookmark.title || bookmark.url} url={bookmark.url} onOpen={onOpen} testID={`light-home-bookmark-${bookmark.id}`} />
          ))
        )}
      </View>
    </ScrollView>
  );
});
