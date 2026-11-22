import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { ds, DsHeader, DsIcon, DsScreen, DsText } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useRtl, useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useDownloadsStore } from '@/store/downloads';

import {
  DownloadDeleteDialog,
  DownloadEmptyState,
  DownloadErrorState,
  DownloadsHeaderControls,
  DownloadsList,
  DownloadSkeleton,
} from './components';
import { DownloadsBulkBar } from './components/DownloadsBulkBar';
import { DownloadsTotalSpeed } from './components/DownloadsTotalSpeed';
import { useDownloadsBulkActions } from './hooks/useDownloadsBulkActions';
import { useTotalDownloadSpeed } from './hooks/useDownloadProgressDetails';
import { useDownloadsScreen } from './hooks/useDownloadsScreen';
import { useTapToToggle } from './hooks/useTapToToggle';
import {
  registerQualitySelectionDownloadListener,
  useQualitySelectionContext,
} from './quality';

const TOAST_MS = 2200;
const FAB_BOTTOM = 24;

/** The running v2 downloads (the header's "3 active"); the same rows the total speed sums. */
function selectActiveCount(state: ReturnType<typeof useDownloadsStore.getState>): number {
  let count = 0;
  for (const item of Object.values(state.engineRowsById)) {
    if (item.status === 'DOWNLOADING') {
      count += 1;
    }
  }
  return count;
}

/**
 * The design's floating "+ Add link" pill (DsFab's look, measured in `ds`), with a long press for the sheet that
 * keeps the queue, batch add, history, paste link and Cancel all reachable. Swap for `DsFab` once it takes
 * `onLongPress`.
 */
const AddLinkFab = memo(function AddLinkFab({
  label,
  onPress,
  onLongPress,
  accessibilityHint,
  testID,
}: {
  label: string;
  onPress: () => void;
  onLongPress: () => void;
  accessibilityHint: string;
  testID?: string;
}) {
  const theme = useTheme();
  const rtl = useRtl();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', bottom: FAB_BOTTOM, end: ds.space.screenX }}>
      <Pressable
        testID={testID}
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        style={({ pressed }) => ({
          height: ds.size.fab,
          borderRadius: ds.radius.fab,
          paddingStart: 20,
          paddingEnd: 22,
          backgroundColor: pressed ? theme.colors.primaryDark : theme.colors.primary,
          flexDirection: rtl.rowDirection,
          alignItems: 'center',
          gap: 8,
          ...ds.shadow.fab,
        })}>
        <DsIcon name="plus" size={20} color="textOnPrimary" strokeWidth={2.2} />
        <DsText variant="button" color="textOnPrimary" style={{ fontSize: ds.text.fab, lineHeight: 22 }}>
          {label}
        </DsText>
      </Pressable>
    </View>
  );
});

export const DownloadsScreen = memo(function DownloadsScreen() {
  const theme = useTheme();
  const { t, tp } = useTranslation();
  const [toastVisible, setToastVisible] = useState(false);
  const [moreSheetVisible, setMoreSheetVisible] = useState(false);
  const [cancelAllConfirm, setCancelAllConfirm] = useState(false);
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
  // The empty state's "Open Browser" just opens it; only the paste button reads the clipboard.
  const openBrowser = useCallback(() => {
    navigation.navigate(routePaths.browser);
  }, []);

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
    sortSheetVisible,
    deleteTargetId,
    deleteMode,
    deleting,
    controlsDirty,
    onChangeSearch,
    onSubmitSearch,
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

  const bulk = useDownloadsBulkActions();
  const activeCount = useDownloadsStore(selectActiveCount);
  const totalSpeed = useTotalDownloadSpeed();

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

  const tapToggle = useTapToToggle({ pause: handlePause, resume: handleResume });

  const handlePressItem = useCallback(
    (id: string) => {
      if (tapToggle(id)) {
        return;
      }
      openDetails(id);
    },
    [openDetails, tapToggle],
  );

  const openFavorites = useCallback(() => {
    navigation.push(routePaths.favorites);
  }, []);

  const openAddLink = useCallback(() => {
    navigation.push(routePaths.downloadsAdd);
  }, []);

  const openMoreSheet = useCallback(() => setMoreSheetVisible(true), []);
  const closeMoreSheet = useCallback(() => setMoreSheetVisible(false), []);
  const closeCancelAllConfirm = useCallback(() => setCancelAllConfirm(false), []);

  const cancellableCount = bulk.summary.cancellableIds.length;
  const moreActions = useMemo<ActionSheetItem[]>(() => {
    const items: ActionSheetItem[] = [
      { id: 'queue', label: t('queueScreen.title'), onPress: () => navigation.push(routePaths.downloadQueue) },
      { id: 'batch-add', label: t('lightDownloads.batchAdd'), onPress: () => navigation.push(routePaths.batchAdd) },
      { id: 'paste-link', label: t('home.pasteLink'), onPress: openPasteLink },
      { id: 'history', label: t('lightDownloads.downloadHistory'), onPress: () => navigation.push(routePaths.downloadHistory) },
    ];
    if (cancellableCount > 0) {
      items.push({
        id: 'cancel-all',
        label: t('downloadBulk.cancelAll'),
        destructive: true,
        onPress: () => setCancelAllConfirm(true),
      });
    }
    return items;
  }, [cancellableCount, openPasteLink, t]);

  // "3 active · 14.2 MB/s" while something downloads; otherwise how many downloads the list holds.
  const subtitle =
    activeCount > 0
      ? totalSpeed
        ? t('lightDownloads.activeSummary', { count: activeCount, speed: totalSpeed })
        : t('lightDownloads.activeCount', { count: activeCount })
      : total > 0
        ? tp('plurals.downloadsOther', total)
        : undefined;

  const header = (
    <View style={{ gap: 10, marginBottom: 10 }}>
      <DsHeader
        title={t('downloads.title')}
        subtitle={subtitle}
        action={{
          icon: 'heart',
          accessibilityLabel: t('downloads.openFavoritesA11y'),
          accessibilityHint: t('downloads.openFavoritesHint'),
          onPress: openFavorites,
          testID: 'downloads-favorites-button',
        }}
        testID="downloads-header"
      />
      <DownloadsHeaderControls
        searchDraft={searchDraft}
        statusFilter={statusFilter}
        sort={sort}
        controlsDirty={controlsDirty}
        sortSheetVisible={sortSheetVisible}
        onChangeSearch={onChangeSearch}
        onSubmitSearch={onSubmitSearch}
        onOpenSort={openSortSheet}
        onCloseSort={closeSortSheet}
        onSelectFilter={onSelectFilter}
        onSelectSort={onSelectSort}
        onReset={resetControls}
      />
      <DownloadsTotalSpeed variant="card" />
      <DownloadsBulkBar bulk={bulk} cancelConfirmVisible={cancelAllConfirm} onCancelConfirmClosed={closeCancelAllConfirm} />
      {error && status === 'ready' ? (
        <DsText variant="rowSub" color="error" accessibilityLiveRegion="polite">
          {error}
        </DsText>
      ) : null}
    </View>
  );

  return (
    <DsScreen scroll={false} testID="downloads-screen">
      {status !== 'ready' ? <View style={{ paddingHorizontal: ds.space.screenX }}>{header}</View> : null}

      {status === 'loading' ? <DownloadSkeleton /> : null}

      {status === 'error' && error ? (
        <DownloadErrorState message={error} onRetry={handleListRetry} refreshing={refreshing} />
      ) : null}

      {status === 'empty' ? (
        <DownloadEmptyState onActionPress={openBrowser} refreshing={refreshing} onRefresh={handleRefresh} />
      ) : null}

      {status === 'empty-search' ? (
        <DownloadEmptyState variant="search" refreshing={refreshing} onRefresh={handleRefresh} />
      ) : null}

      {status === 'empty-filter' ? (
        <DownloadEmptyState variant="filter" refreshing={refreshing} onRefresh={handleRefresh} />
      ) : null}

      {status === 'empty-completed' ? (
        <DownloadEmptyState variant="completed" refreshing={refreshing} onRefresh={handleRefresh} />
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
          onLongPressItem={openDetails}
          onPause={handlePause}
          onResume={handleResume}
          onCancel={handleCancel}
          onRetry={handleRetryDownload}
          onOpen={handleOpenDownload}
          onShare={handleShareDownload}
          onRemove={requestDelete}
          ListHeaderComponent={header}
        />
      ) : null}

      <AddLinkFab
        label={t('lightDownloads.addLink')}
        onPress={openAddLink}
        onLongPress={openMoreSheet}
        accessibilityHint={t('lightDownloads.addLinkHint')}
        testID="downloads-add-link-fab"
      />

      <ActionSheetModal
        visible={moreSheetVisible}
        onClose={closeMoreSheet}
        title={t('lightDownloads.moreTitle')}
        actions={moreActions}
        testID="downloads-more-sheet"
      />

      <DownloadDeleteDialog
        visible={Boolean(deleteTargetId)}
        mode={deleteMode}
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={cancelDelete}
      />

      {toastVisible ? (
        <View
          pointerEvents="none"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          accessibilityLabel={t('downloads.successToast')}
          style={{
            position: 'absolute',
            left: ds.space.screenX,
            right: ds.space.screenX,
            bottom: FAB_BOTTOM + ds.size.fab + 12,
            zIndex: 40,
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderRadius: ds.radius.button,
            backgroundColor: theme.colors.textPrimary,
            opacity: 0.94,
          }}>
          <DsText variant="rowSub" color="textOnPrimary" align="center">
            {t('downloads.successToast')}
          </DsText>
        </View>
      ) : null}
    </DsScreen>
  );
});
