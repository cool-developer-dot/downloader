import { memo, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { formatBytes } from '@/browser/capture/capture-core';
import { deleteSavedPage, listSavedPages, openSavedPage, useSavedPagesVersion } from '@/browser/capture/offline-pages.service';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import type { SavedPage } from '@/storage/repositories/saved-pages.repository';

/** B17 #178 — the pages saved for reading offline (this profile): open read-only, delete. */
export const SavedPagesScreen = memo(function SavedPagesScreen() {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const changes = useSavedPagesVersion();
  const [pages, setPages] = useState<SavedPage[]>([]);
  const [toDelete, setToDelete] = useState<SavedPage | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listSavedPages().then((list) => {
      if (!cancelled) setPages(list);
    });
    return () => {
      cancelled = true;
    };
  }, [changes]);

  return (
    <SafeAreaScreen testID="saved-pages-screen" padded={false} edges={['top', 'left', 'right', 'bottom']} style={{ backgroundColor: theme.colors.background }}>
      <ScreenHeader title={t('browserCapture.savedPages')} showBack onBackPress={() => navigation.back()} />
      <FlatList
        data={pages}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        ListEmptyComponent={
          <Text variant="bodySmall" color="textSecondary" style={{ textAlign: rtl.textAlign, paddingVertical: 24 }}>
            {t('browserCapture.savedPagesEmpty')}
          </Text>
        }
        renderItem={({ item }) => (
          <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', borderRadius: theme.radius.md, backgroundColor: theme.colors.card }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => void openSavedPage(item)}
              testID={`saved-page-${item.id}`}
              style={{ flex: 1, minHeight: 56, padding: 12, gap: 2 }}>
              <Text variant="body" numberOfLines={2} style={{ textAlign: rtl.textAlign }}>
                {item.title}
              </Text>
              <Text variant="caption" color="textSecondary" numberOfLines={1} style={{ textAlign: rtl.textAlign }}>
                {t('browserCapture.savedPageSize', { size: formatBytes(item.size), date: item.createdAt.slice(0, 10) })}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t('browserCapture.delete')}: ${item.title}`}
              onPress={() => setToDelete(item)}
              style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="delete-outline" size={20} color="error" />
            </Pressable>
          </View>
        )}
      />
      <ConfirmModal
        visible={toDelete != null}
        variant="delete"
        title={t('browserCapture.deleteSavedTitle')}
        message={toDelete?.title ?? ''}
        confirmLabel={t('browserCapture.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          if (toDelete) void deleteSavedPage(toDelete);
          setToDelete(null);
        }}
        onCancel={() => setToDelete(null)}
      />
    </SafeAreaScreen>
  );
});
