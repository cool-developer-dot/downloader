import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { IconButton } from '@/components/buttons/IconButton';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';

import {
  DownloadDeleteDialog,
  DownloadEmptyState,
  DownloadErrorState,
  DownloadsHeaderControls,
  DownloadsList,
  DownloadSkeleton,
} from './components';
import { useDownloadsScreen } from './hooks/useDownloadsScreen';
import {
  registerQualitySelectionDownloadListener,
  useQualitySelectionContext,
} from './quality';
import { useDownloadsTokens } from './theme/downloads-tokens';

const TOAST_MS = 2200;

export const DownloadsScreen = memo(function DownloadsScreen() {
  const downloadsTokens = useDownloadsTokens();
  const theme = useTheme();
  const { t, tp } = useTranslation();
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSuccessToast = useCallback(() => {
    setToastVisible(true);
    AccessibilityInfo.announceForAccessibility(t('downloads.successToast'));
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
      toastTimerRef.current = null;
    }, TOAST_MS);
  }, [t]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return registerQualitySelectionDownloadListener(showSuccessToast);
  }, [showSuccessToast]);

  const qualitySelection = useQualitySelectionContext();
  const openPasteLink = qualitySelection.open;

  const {
    orderedIds,
    sections,
    showSections,
    total,
    refreshing,
    loadingMore,
    hasMore,
    error,
    status,
    searchDraft,
    statusFilter,
    sort,
    filterSheetVisible,
    sortSheetVisible,
    deleteTargetId,
    deleteMode,
    deleting,
    controlsDirty,
    onChangeSearch,
    onSubmitSearch,
    openFilterSheet,
    closeFilterSheet,
    openSortSheet,
    closeSortSheet,
    onSelectFilter,
    onSelectSort,
    resetControls,
    requestDelete,
    cancelDelete,
    confirmDelete,
    onPause,
    onResume,
    onCancel,
    onRetry,
    onOpen,
    onShare,
    openDetails,
    refresh,
    loadMore,
  } = useDownloadsScreen();

  const handleListRetry = useCallback(() => {
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

  const handlePause = useCallback(
    (id: string) => {
      void onPause(id);
    },
    [onPause],
  );

  const handleResume = useCallback(
    (id: string) => {
      void onResume(id);
    },
    [onResume],
  );

  const handleCancel = useCallback(
    (id: string) => {
      void onCancel(id);
    },
    [onCancel],
  );

  const handleRetryDownload = useCallback(
    (id: string) => {
      void onRetry(id);
    },
    [onRetry],
  );

  const handleOpenDownload = useCallback(
    (id: string) => {
      void onOpen(id);
    },
    [onOpen],
  );

  const handleShareDownload = useCallback(
    (id: string) => {
      void onShare(id);
    },
    [onShare],
  );

  const handlePressItem = useCallback(
    (id: string) => {
      openDetails(id);
    },
    [openDetails],
  );

  const openFavorites = useCallback(() => {
    navigation.push(routePaths.favorites);
  }, []);

  const openQueue = useCallback(() => {
    navigation.push(routePaths.downloadQueue);
  }, []);

  const subtitle = total > 0 ? tp('plurals.itemsOther', total) : undefined;

  return (
    <SafeAreaScreen
      testID="downloads-screen"
      padded={false}
      edges={['top', 'left', 'right', 'bottom']}
      style={{ backgroundColor: theme.colors.background }}>
      <ScreenHeader
        title={t('downloads.title')}
        subtitle={subtitle}
        actions={
          <Box row gap={4} style={{ alignItems: 'center' }}>
            <IconButton
              icon="format-list-bulleted"
              accessibilityLabel={t('downloads.openQueue')}
              accessibilityHint={t('downloads.openQueueHint')}
              onPress={openQueue}
              variant="ghost"
              color="headerIcon"
              testID="downloads-queue-button"
            />
            <IconButton
              icon="link-plus"
              accessibilityLabel={t('home.pasteLink')}
              accessibilityHint={t('downloads.pasteLinkHint')}
              onPress={openPasteLink}
              variant="ghost"
              color="headerIcon"
              testID="downloads-paste-link-button"
            />
            <IconButton
              icon="heart-outline"
              accessibilityLabel={t('downloads.openFavoritesA11y')}
              accessibilityHint={t('downloads.openFavoritesHint')}
              onPress={openFavorites}
              variant="ghost"
              color="headerIcon"
              testID="downloads-favorites-button"
            />
          </Box>
        }
        testID="downloads-header"
      />

      <Box py={12} gap={4}>
        <DownloadsHeaderControls
          searchDraft={searchDraft}
          statusFilter={statusFilter}
          sort={sort}
          controlsDirty={controlsDirty}
          filterSheetVisible={filterSheetVisible}
          sortSheetVisible={sortSheetVisible}
          onChangeSearch={onChangeSearch}
          onSubmitSearch={onSubmitSearch}
          onOpenFilter={openFilterSheet}
          onCloseFilter={closeFilterSheet}
          onOpenSort={openSortSheet}
          onCloseSort={closeSortSheet}
          onSelectFilter={onSelectFilter}
          onSelectSort={onSelectSort}
          onReset={resetControls}
        />
      </Box>

      {error && status === 'ready' ? (
        <Box px={downloadsTokens.spacing.screenX} pb={8}>
          <Text variant="caption" color="error" accessibilityLiveRegion="polite">
            {error}
          </Text>
        </Box>
      ) : null}

      {status === 'loading' ? <DownloadSkeleton /> : null}

      {status === 'error' && error ? (
        <DownloadErrorState
          message={error}
          onRetry={handleListRetry}
          refreshing={refreshing}
        />
      ) : null}

      {status === 'empty' ? (
        <DownloadEmptyState
          onActionPress={openPasteLink}
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      ) : null}

      {status === 'empty-search' ? (
        <DownloadEmptyState
          variant="search"
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      ) : null}

      {status === 'empty-filter' ? (
        <DownloadEmptyState
          variant="filter"
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      ) : null}

      {status === 'empty-completed' ? (
        <DownloadEmptyState
          variant="completed"
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      ) : null}

      {status === 'ready' ? (
        <DownloadsList
          orderedIds={orderedIds}
          sections={sections}
          showSections={showSections}
          refreshing={refreshing}
          loadingMore={loadingMore}
          hasMore={hasMore}
          onRefresh={handleRefresh}
          onEndReached={handleEndReached}
          onPressItem={handlePressItem}
          onPause={handlePause}
          onResume={handleResume}
          onCancel={handleCancel}
          onRetry={handleRetryDownload}
          onOpen={handleOpenDownload}
          onShare={handleShareDownload}
          onRemove={requestDelete}
        />
      ) : null}

      <DownloadDeleteDialog
        visible={Boolean(deleteTargetId)}
        mode={deleteMode}
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={cancelDelete}
      />

      {toastVisible ? (
        <Box
          pointerEvents="none"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          accessibilityLabel={t('downloads.successToast')}
          style={{
            position: 'absolute',
            left: downloadsTokens.spacing.screenX,
            right: downloadsTokens.spacing.screenX,
            bottom: 24,
            zIndex: 40,
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderRadius: theme.radius.md,
            backgroundColor: theme.colors.black,
            opacity: 0.92,
            borderWidth: 1,
            borderColor: theme.colors.border,
          }}>
          <Text variant="bodySmall" color="white" align="center">
            {t('downloads.successToast')}
          </Text>
        </Box>
      ) : null}
    </SafeAreaScreen>
  );
});