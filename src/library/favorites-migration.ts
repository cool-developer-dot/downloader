/**
 * One-time move of favorites made before videos had favorites of their own onto the library item's own favorite.
 *
 * Two legacy sources, each moved only where it names one video without doubt:
 * - v1 download favorites (`downloads_catalog.favorite`): v1 favorited one download, and the native import of v1 files
 *   kept every download's id, so the library item with that id is exactly the one.
 * - Page favorites (`url_favorites`): a heart on a page, not on a video. It becomes a video's own favorite only when
 *   exactly one downloaded video came from that page. A page with several videos is ambiguous and is left as it is
 *   rather than guessing (or marking all of them); a page one of whose videos already has its own favorite was
 *   already answered by the user; a page with no downloaded video has nothing to move.
 *
 * Nothing is ever un-favorited, no page favorite is added or removed, and an item that already is a favorite is not
 * touched — running it again changes nothing.
 */
import { normalizeFavoriteSourceKey } from '@/storage/utils/favorite-key';

export type FavoritesMigrationLibraryItem = {
  id: string;
  pageUrl: string | null;
  favorite: boolean;
};

export type FavoritesMigrationPlan = {
  /** Library items to mark as favorites; never one that already is one. */
  favoriteIds: string[];
  /** Matched by a v1 download favorite (same id). */
  fromDownloads: number;
  /** Matched by a page favorite whose page has exactly one downloaded video. */
  fromPages: number;
  /** Page favorites whose page has several downloaded videos: left alone. */
  ambiguousPages: number;
  /** Page favorites whose page already has a video with its own favorite: left alone. */
  alreadyChosenPages: number;
  /** Page favorites with no downloaded video: nothing to move. */
  unmatchedPages: number;
};

export function planFavoritesMigration(input: {
  legacyFavoriteDownloadIds: readonly string[];
  pageFavoriteUrls: readonly string[];
  library: readonly FavoritesMigrationLibraryItem[];
}): FavoritesMigrationPlan {
  const byId = new Map(input.library.map((item) => [item.id, item]));
  const byPage = new Map<string, FavoritesMigrationLibraryItem[]>();
  for (const item of input.library) {
    const key = item.pageUrl ? normalizeFavoriteSourceKey(item.pageUrl) : '';
    if (!key) {
      continue;
    }
    const items = byPage.get(key) ?? [];
    items.push(item);
    byPage.set(key, items);
  }

  const chosen = new Set<string>();
  const plan: FavoritesMigrationPlan = {
    favoriteIds: [],
    fromDownloads: 0,
    fromPages: 0,
    ambiguousPages: 0,
    alreadyChosenPages: 0,
    unmatchedPages: 0,
  };

  for (const id of new Set(input.legacyFavoriteDownloadIds)) {
    const item = byId.get(id);
    if (item && !item.favorite && !chosen.has(id)) {
      chosen.add(id);
      plan.fromDownloads += 1;
    }
  }

  const pageKeys = new Set(
    input.pageFavoriteUrls.map((url) => normalizeFavoriteSourceKey(url)).filter((key) => key.length > 0),
  );
  for (const key of pageKeys) {
    const items = byPage.get(key) ?? [];
    if (items.length === 0) {
      plan.unmatchedPages += 1;
    } else if (items.some((item) => item.favorite)) {
      plan.alreadyChosenPages += 1;
    } else if (items.length > 1) {
      plan.ambiguousPages += 1;
    } else if (!chosen.has(items[0]!.id)) {
      chosen.add(items[0]!.id);
      plan.fromPages += 1;
    }
  }

  plan.favoriteIds = [...chosen];
  return plan;
}

export type FavoritesMigrationDeps = {
  isDone(): boolean;
  markDone(): void;
  /** Resolves once the native import of v1 files has run, so their library items exist. */
  waitForLegacyImport(): Promise<void>;
  listLibrary(): Promise<FavoritesMigrationLibraryItem[]>;
  readLegacyFavoriteDownloadIds(): Promise<string[]>;
  readPageFavoriteUrls(): Promise<string[]>;
  applyFavorites(ids: string[]): Promise<void>;
  log?: (event: string, fields?: Record<string, unknown>) => void;
};

/**
 * Runs the migration once. It is marked done only after every chosen favorite was applied, so an interrupted or
 * failed run is simply retried at the next start (and, being idempotent, never applies anything twice).
 */
export async function runFavoritesMigration(deps: FavoritesMigrationDeps): Promise<FavoritesMigrationPlan | null> {
  if (deps.isDone()) {
    return null;
  }
  try {
    await deps.waitForLegacyImport();
    const [library, legacyFavoriteDownloadIds, pageFavoriteUrls] = await Promise.all([
      deps.listLibrary(),
      deps.readLegacyFavoriteDownloadIds(),
      deps.readPageFavoriteUrls(),
    ]);
    const plan = planFavoritesMigration({ legacyFavoriteDownloadIds, pageFavoriteUrls, library });
    if (plan.favoriteIds.length > 0) {
      await deps.applyFavorites(plan.favoriteIds);
    }
    deps.markDone();
    deps.log?.('favorites.migrated', {
      favorited: plan.favoriteIds.length,
      fromDownloads: plan.fromDownloads,
      fromPages: plan.fromPages,
      ambiguousPages: plan.ambiguousPages,
      alreadyChosenPages: plan.alreadyChosenPages,
      unmatchedPages: plan.unmatchedPages,
    });
    return plan;
  } catch (error) {
    deps.log?.('favorites.migration_failed', {
      message: error instanceof Error ? error.message.slice(0, 120) : null,
    });
    return null;
  }
}
