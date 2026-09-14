import { memo, useCallback } from 'react';

import { Box } from '@/components/base/Box';
import { IconButton } from '@/components/buttons/IconButton';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { SearchField } from '@/components/inputs/SearchField';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import type { BookmarkEntry } from '@/storage/types';

import {
  BookmarkDeleteDialog,
  BookmarkEmptyState,
  BookmarkErrorState,
  BookmarksList,
  BookmarkSkeleton,
} from './components';
import { useBookmarksScreen } from './hooks/useBookmarksScreen';
import { useBookmarksTokens } from './theme/bookmarks-tokens';

export const BookmarksScreen = memo(function BookmarksScreen() {
  const bookmarksTokens = useBookmarksTokens();
  const { t } = useTranslation();
  const {
    items,
    total,
    refreshing,
    loadingMore,
    hasMore,
    error,
    status,
    searchDraft,
    clearVisible,
    deleteTargetId,
    deleting,
    clearing,
    onChangeSearch,
    onSubmitSearch,
    openEntry,
    requestDelete,
    cancelDelete,
    confirmDelete,
    openClear,
    cancelClear,
    confirmClear,
    openBrowser,
    refresh,
    loadMore,
  } = useBookmarksScreen();

  const handleBack = useCallback(() => {
    navigation.back();
  }, []);

  const handlePressItem = useCallback(
    (item: BookmarkEntry) => {
      openEntry(item.url);
    },
    [openEntry],
  );

  const handleDeleteItem = useCallback(
    (item: BookmarkEntry) => {
      requestDelete(item.id);
    },
    [requestDelete],
  );

  const handleRetry = useCallback(() => {
    void refresh();
  }, [refresh]);

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const handleEndReached = useCallback(() => {
    void loadMore();
  }, [loadMore]);

  const handleConfirmDelete = useCallback(() => {
    void confirmDelete();
  }, [confirmDelete]);

  const handleConfirmClear = useCallback(() => {
    void confirmClear();
  }, [confirmClear]);

  const canClear = items.length > 0 || total > 0;

  return (
    <SafeAreaScreen
      testID="bookmarks-screen"
      padded={false}
      edges={['top', 'left', 'right', 'bottom']}
      style={{ backgroundColor: bookmarksTokens.background }}>
      <ScreenHeader
        title={t('bookmarks.title')}
        showBack
        onBackPress={handleBack}
        actions={
          canClear ? (
            <IconButton
              icon="delete-sweep-outline"
              accessibilityLabel={t('bookmarks.clearAllA11y')}
              onPress={openClear}
              variant="ghost"
              color="headerIcon"
              testID="bookmarks-clear-button"
            />
          ) : null
        }
        testID="bookmarks-header"
      />

      <Box px={bookmarksTokens.spacing.screenX} py={12}>
        <SearchField
          value={searchDraft}
          onChangeText={onChangeSearch}
          onSearch={onSubmitSearch}
          placeholder={t('bookmarks.searchPlaceholder')}
          testID="bookmarks-search-field"
        />
      </Box>

      {status === 'loading' ? <BookmarkSkeleton /> : null}

      {status === 'error' && error ? (
        <BookmarkErrorState message={error} onRetry={handleRetry} />
      ) : null}

      {status === 'empty' ? <BookmarkEmptyState onActionPress={openBrowser} /> : null}

      {status === 'empty-search' ? <BookmarkEmptyState variant="search" /> : null}

      {status === 'ready' ? (
        <BookmarksList
          items={items}
          refreshing={refreshing}
          loadingMore={loadingMore}
          hasMore={hasMore}
          onRefresh={handleRefresh}
          onEndReached={handleEndReached}
          onPressItem={handlePressItem}
          onDeleteItem={handleDeleteItem}
        />
      ) : null}

      <BookmarkDeleteDialog
        mode="delete"
        visible={Boolean(deleteTargetId)}
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={cancelDelete}
      />

      <BookmarkDeleteDialog
        mode="clear"
        visible={clearVisible}
        loading={clearing}
        onConfirm={handleConfirmClear}
        onCancel={cancelClear}
      />
    </SafeAreaScreen>
  );
});
