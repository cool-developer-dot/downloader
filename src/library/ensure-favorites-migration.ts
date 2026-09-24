import { listWholeLibrary } from '@/downloads/v2/bridge';
import { getV2Engine } from '@/downloads/v2/engine-port';
import { mmkvKeys } from '@/storage/constants';
import { mmkvGetBoolean, mmkvSetBoolean } from '@/storage/mmkv/helpers';
import { downloadCatalogRepository, urlFavoriteRepository } from '@/storage/repositories';

import { runFavoritesMigration } from './favorites-migration';

let started = false;

function log(event: string, fields?: Record<string, unknown>): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[Favorites]', { event, ...fields });
  }
}

/**
 * Moves favorites made before videos had favorites of their own onto the library items they unambiguously name (see
 * favorites-migration.ts), once. Idempotent; a build without the native module has nothing to migrate onto.
 */
export function ensureFavoritesMigration(): void {
  if (started) {
    return;
  }
  const engine = getV2Engine();
  if (!engine?.applyLegacyMetadata) {
    return;
  }
  started = true;
  const apply = engine.applyLegacyMetadata.bind(engine);
  void runFavoritesMigration({
    isDone: () => mmkvGetBoolean(mmkvKeys.favoritesPerItemMigratedV1) === true,
    markDone: () => mmkvSetBoolean(mmkvKeys.favoritesPerItemMigratedV1, true),
    // Nothing to apply yet: resolves once the native import of v1 files has created their library items.
    waitForLegacyImport: () => apply([]),
    listLibrary: async () =>
      (await listWholeLibrary(engine)).map((item) => ({
        id: item.id,
        pageUrl: item.pageUrl,
        favorite: item.favorite,
      })),
    readLegacyFavoriteDownloadIds: () => downloadCatalogRepository.listFavoriteMediaIds(),
    readPageFavoriteUrls: () => urlFavoriteRepository.listAllSourceKeys(),
    applyFavorites: (ids) => apply(ids.map((id) => ({ id, favorite: true }))),
    log,
  });
}
