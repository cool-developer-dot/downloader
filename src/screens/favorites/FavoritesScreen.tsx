import { memo, useCallback } from 'react';
import { View } from 'react-native';

import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { ds, DsHeader, DsScreen, DsSearchField } from '@/design';
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

/** Favorites, in the light design's chrome: a sub-screen header, the 56 dp search field and white cards. */
export const FavoritesScreen = memo(function FavoritesScreen() {
  const { t, tp } = useTranslation();
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

  const subtitle = total > 0 ? tp('plurals.itemsOther', total) : undefined;

  return (
    <DsScreen scroll={false} testID="favorites-screen">
      <View style={{ paddingHorizontal: ds.space.screenX, gap: 10, marginBottom: 10 }}>
        <DsHeader title={t('favorites.title')} subtitle={subtitle} onBack={goBack} testID="favorites-header" />
        <DsSearchField
          value={searchDraft}
          onChangeText={onChangeSearch}
          onSubmitEditing={(event) => onSubmitSearch(event.nativeEvent.text)}
          returnKeyType="search"
          placeholder={t('favorites.searchPlaceholder')}
          accessibilityLabel={t('favorites.searchPlaceholder')}
          actions={searchDraft ? [{ icon: 'x', accessibilityLabel: t('lightDownloads.clearSearch'), onPress: () => onSubmitSearch('') }] : undefined}
          testID="favorites-search-field"
        />
      </View>

      {status === 'loading' ? <FavoriteSkeleton /> : null}

      {status === 'error' && error ? <FavoriteErrorState message={error} onRetry={handleRetry} /> : null}

      {status === 'empty' ? <FavoriteEmptyState onActionPress={openDownloads} /> : null}

      {status === 'empty-search' ? <FavoriteEmptyState variant="search" /> : null}

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
        confirmLabel={t('common.ok')}
        cancelLabel={t('common.close')}
        onConfirm={dismissOpenError}
        onCancel={dismissOpenError}
        testID="favorites-open-error"
      />
    </DsScreen>
  );
});
