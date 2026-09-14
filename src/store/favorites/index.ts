import { createStore } from '@/store/shared/create-store';

import { createFavoritesActions } from './actions';
import { initialFavoritesState } from './state';
import type { FavoritesStore } from './types';

export const useFavoritesStore = createStore<FavoritesStore>((set, get) => ({
  ...initialFavoritesState,
  ...createFavoritesActions(set, get),
}));

export * from './selectors';
export {
  normalizeFavoriteItem,
  normalizeFavoriteSourceKey,
  resolveFavoriteThumbnailUrl,
  toFavoritePlatform,
} from './actions';
export type {
  CreateFavoriteInput,
  FavoriteItem,
  FavoriteListSort,
  FavoritePlatform,
  FavoriteSortOption,
  FavoritesActions,
  FavoritesState,
  FavoritesStore,
} from './types';
