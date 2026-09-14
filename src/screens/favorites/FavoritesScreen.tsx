import { memo, useCallback } from 'react';

import { Box } from '@/components/base/Box';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { SearchField } from '@/components/inputs/SearchField';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { useTranslation } from '@/localization';
import type { FavoriteItem as FavoriteEntry } from '@/store/favorites';

import {
  FavoriteEmptyState,
  FavoriteErrorState,
  FavoriteRemoveDialog,
  FavoritesList,
  FavoriteSkeleton,
} from './components';
import { useFavoritesScreen } from './hooks/useFavoritesScreen';
import { useFavoritesTokens } from './theme/favorites-tokens';

export const FavoritesScreen = memo(function FavoritesScreen() {
  const favoritesTokens = useFavoritesTokens();
  const { t } = useTranslation();
  const {
    orderedIds,
    total,
    refreshing,
    loadingMore,
    hasMore,
    error,
    status,
    searchDraft,
    removeTargetId,
    removing,
    unavailableIds,
    openError,
    onChangeSearch,
    onSubmitSearch,
    openEntry,
    requestRemove,
    cancelRemove,
    confirmRemove,
    openDownloads,
    goBack,
    dismissOpenError,
    refresh,
    loadMore,
  } = useFavoritesScreen();

  const handlePressItem = useCallback(
    (item: FavoriteEntry) => {
      void openEntry(item);
    },
    [openEntry],
  );

  const handleRemoveItem = useCallback(
    (item: FavoriteEntry) => {
      requestRemove(item.id);
    },
    [requestRemove],
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

  const handleConfirmRemove = useCallback(() => {
    void confirmRemove();
  }, [confirmRemove]);

  const subtitle = total > 0 ? `${total} item${total === 1 ? '' : 's'}` : undefined;

  return (
    <SafeAreaScreen
      testID="favorites-screen"
      padded={false}
      edges={['top', 'left', 'right', 'bottom']}
      style={{ backgroundColor: favoritesTokens.background }}>
      <ScreenHeader
        title={t('favorites.title')}
        subtitle={subtitle}
        showBack
        onBackPress={goBack}
        testID="favorites-header"
      />

      <Box px={favoritesTokens.spacing.screenX} py={12}>
        <SearchField
          value={searchDraft}
          onChangeText={onChangeSearch}
          onSearch={onSubmitSearch}
          placeholder={t('favorites.searchPlaceholder')}
          testID="favorites-search-field"
        />
      </Box>

      {status === 'loading' ? <FavoriteSkeleton /> : null}

      {status === 'error' && error ? (
        <FavoriteErrorState message={error} onRetry={handleRetry} />
      ) : null}

      {status === 'empty' ? (
        <FavoriteEmptyState onActionPress={openDownloads} />
      ) : null}

      {status === 'empty-search' ? (
        <FavoriteEmptyState variant="search" />
      ) : null}

      {status === 'ready' ? (
        <FavoritesList
          orderedIds={orderedIds}
          refreshing={refreshing}
          loadingMore={loadingMore}
          hasMore={hasMore}
          unavailableIds={unavailableIds}
          onRefresh={handleRefresh}
          onEndReached={handleEndReached}
          onPressItem={handlePressItem}
          onRemoveItem={handleRemoveItem}
        />
      ) : null}

      <FavoriteRemoveDialog
        visible={Boolean(removeTargetId)}
        loading={removing}
        onConfirm={handleConfirmRemove}
        onCancel={cancelRemove}
      />

      <ConfirmModal
        visible={Boolean(openError)}
        variant="error"
        title={t('favorites.openFailed')}
        message={openError ?? ''}
        confirmLabel="OK"
        cancelLabel="Close"
        onConfirm={dismissOpenError}
        onCancel={dismissOpenError}
        testID="favorites-open-error"
      />
    </SafeAreaScreen>
  );
});
