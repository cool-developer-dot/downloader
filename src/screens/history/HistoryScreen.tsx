import { memo, useCallback } from 'react';

import { Box } from '@/components/base/Box';
import { IconButton } from '@/components/buttons/IconButton';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { SearchField } from '@/components/inputs/SearchField';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import type { BrowserHistoryEntry } from '@/storage/types';

import {
  HistoryClearSearchesRow,
  HistoryDeleteDialog,
  HistoryEmptyState,
  HistoryErrorState,
  HistoryList,
  HistorySkeleton,
} from './components';
import { useHistoryScreen } from './hooks/useHistoryScreen';
import { useHistoryTokens } from './theme/history-tokens';

export const HistoryScreen = memo(function HistoryScreen() {
  const historyTokens = useHistoryTokens();
  const { t } = useTranslation();
  const {
    items,
    total,
    refreshing,
    loadingMore,
    hasMore,
    error,
    status,
    sections,
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
    recentSearchTotal,
    clearSearchesVisible,
    clearingSearches,
    openClearSearches,
    cancelClearSearches,
    confirmClearSearches,
    openBrowser,
    refresh,
    loadMore,
  } = useHistoryScreen();

  const handleBack = useCallback(() => {
    navigation.back();
  }, []);

  const handlePressItem = useCallback(
    (item: BrowserHistoryEntry) => {
      openEntry(item.url);
    },
    [openEntry],
  );

  const handleDeleteItem = useCallback(
    (item: BrowserHistoryEntry) => {
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

  const handleConfirmClearSearches = useCallback(() => {
    void confirmClearSearches();
  }, [confirmClearSearches]);

  const canClear = items.length > 0 || total > 0;

  return (
    <SafeAreaScreen
      testID="history-screen"
      padded={false}
      edges={['top', 'left', 'right', 'bottom']}
      style={{ backgroundColor: historyTokens.background }}>
      <ScreenHeader
        title={t('history.title')}
        showBack
        onBackPress={handleBack}
        actions={
          canClear ? (
            <IconButton
              icon="delete-sweep-outline"
              accessibilityLabel={t('history.clearAllA11y')}
              onPress={openClear}
              variant="ghost"
              color="headerIcon"
              testID="history-clear-button"
            />
          ) : null
        }
        testID="history-header"
      />

      <Box px={historyTokens.spacing.screenX} py={12}>
        <SearchField
          value={searchDraft}
          onChangeText={onChangeSearch}
          onSearch={onSubmitSearch}
          placeholder={t('history.searchPlaceholder')}
          testID="history-search-field"
        />
      </Box>

      {recentSearchTotal > 0 ? (
        <HistoryClearSearchesRow onPress={openClearSearches} disabled={clearingSearches} />
      ) : null}

      {status === 'loading' ? <HistorySkeleton /> : null}

      {status === 'error' && error ? (
        <HistoryErrorState message={error} onRetry={handleRetry} />
      ) : null}

      {status === 'empty' ? <HistoryEmptyState onActionPress={openBrowser} /> : null}

      {status === 'empty-search' ? <HistoryEmptyState variant="search" /> : null}

      {status === 'ready' ? (
        <HistoryList
          sections={sections}
          refreshing={refreshing}
          loadingMore={loadingMore}
          hasMore={hasMore}
          onRefresh={handleRefresh}
          onEndReached={handleEndReached}
          onPressItem={handlePressItem}
          onDeleteItem={handleDeleteItem}
        />
      ) : null}

      <HistoryDeleteDialog
        mode="delete"
        visible={Boolean(deleteTargetId)}
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={cancelDelete}
      />

      <HistoryDeleteDialog
        mode="clear"
        visible={clearVisible}
        loading={clearing}
        onConfirm={handleConfirmClear}
        onCancel={cancelClear}
      />

      <HistoryDeleteDialog
        mode="clearSearches"
        visible={clearSearchesVisible}
        loading={clearingSearches}
        onConfirm={handleConfirmClearSearches}
        onCancel={cancelClearSearches}
      />
    </SafeAreaScreen>
  );
});
