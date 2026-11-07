import { memo, useCallback, useState } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { Box } from '@/components/base/Box';
import { IconButton } from '@/components/buttons/IconButton';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { SearchField } from '@/components/inputs/SearchField';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import type { BrowserHistoryEntry } from '@/storage/types';
import { ClearBrowsingDataSheet } from '@/browser/history/components/ClearBrowsingDataSheet';
import { HistoryOffBanner } from '@/browser/history/components/HistoryOffBanner';
import { exportHistoryToFile } from '@/browser/history/history-export.service';

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
    query,
  } = useHistoryScreen();

  // B10 #98 / #103: clear by time range, export as CSV.
  const [rangeSheetVisible, setRangeSheetVisible] = useState(false);
  const [exporting, setExporting] = useState(false);
  const handleExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    const notify = (message: string) => {
      if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
      AccessibilityInfo.announceForAccessibility(message);
    };
    try {
      const outcome = await exportHistoryToFile();
      if (outcome === 'empty') notify(t('browserHistory.exportEmpty'));
      else if (outcome === 'saved' || outcome === 'shared') notify(t('browserHistory.exportSaved'));
      else if (outcome === 'failed') notify(t('browserHistory.exportFailed'));
    } catch {
      notify(t('browserHistory.exportFailed'));
    } finally {
      setExporting(false);
    }
  }, [exporting, t]);

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
            <Box row style={{ alignItems: 'center' }}>
              <IconButton
                icon="file-export-outline"
                accessibilityLabel={t('browserHistory.exportA11y')}
                onPress={() => void handleExport()}
                disabled={exporting}
                variant="ghost"
                color="headerIcon"
                testID="history-export-button"
              />
              <IconButton
                icon="delete-clock-outline"
                accessibilityLabel={t('browserHistory.clearDataA11y')}
                onPress={() => setRangeSheetVisible(true)}
                variant="ghost"
                color="headerIcon"
                testID="history-clear-range-button"
              />
              <IconButton
                icon="delete-sweep-outline"
                accessibilityLabel={t('history.clearAllA11y')}
                onPress={openClear}
                variant="ghost"
                color="headerIcon"
                testID="history-clear-button"
              />
            </Box>
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

      <HistoryOffBanner />

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
          highlightQuery={query}
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

      <ClearBrowsingDataSheet
        visible={rangeSheetVisible}
        onClose={() => setRangeSheetVisible(false)}
        testID="history-clear-range"
      />
    </SafeAreaScreen>
  );
});
