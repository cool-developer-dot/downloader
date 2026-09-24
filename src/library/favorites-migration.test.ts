import assert from 'node:assert/strict';
import test from 'node:test';

import {
  planFavoritesMigration,
  runFavoritesMigration,
  type FavoritesMigrationDeps,
  type FavoritesMigrationLibraryItem,
} from './favorites-migration.ts';

const item = (id: string, pageUrl: string | null, favorite = false): FavoritesMigrationLibraryItem => ({
  id,
  pageUrl,
  favorite,
});

test('a v1 download favorite moves to the library item with the same id', () => {
  const plan = planFavoritesMigration({
    legacyFavoriteDownloadIds: ['v1-a', 'v1-gone'],
    pageFavoriteUrls: [],
    library: [item('v1-a', null), item('v1-b', null)],
  });
  assert.deepEqual(plan.favoriteIds, ['v1-a']);
  assert.equal(plan.fromDownloads, 1);
});

test('a page favorite moves only when exactly one downloaded video came from that page', () => {
  const plan = planFavoritesMigration({
    legacyFavoriteDownloadIds: [],
    pageFavoriteUrls: [
      'https://site.example/watch/one/', // one video (trailing slash / hash do not matter)
      'https://site.example/feed', // two videos: ambiguous
      'https://site.example/nothing', // no video downloaded from it
    ],
    library: [
      item('one', 'https://site.example/watch/one#t=3'),
      item('feed-1', 'https://site.example/feed'),
      item('feed-2', 'https://SITE.example/feed'),
    ],
  });
  assert.deepEqual(plan.favoriteIds, ['one']);
  assert.equal(plan.fromPages, 1);
  assert.equal(plan.ambiguousPages, 1, 'never mark every video of a page');
  assert.equal(plan.unmatchedPages, 1);
});

test('a page where the user already favorited one of its videos is left as the user set it', () => {
  const plan = planFavoritesMigration({
    legacyFavoriteDownloadIds: [],
    pageFavoriteUrls: ['https://site.example/p'],
    library: [item('chosen', 'https://site.example/p', true), item('other', 'https://site.example/other')],
  });
  assert.deepEqual(plan.favoriteIds, []);
  assert.equal(plan.alreadyChosenPages, 1);
});

test('existing per-video favorites are never touched and nothing is chosen twice', () => {
  const plan = planFavoritesMigration({
    legacyFavoriteDownloadIds: ['a', 'a', 'already'],
    pageFavoriteUrls: ['https://site.example/a', 'https://site.example/a'],
    library: [item('a', 'https://site.example/a'), item('already', null, true)],
  });
  assert.deepEqual(plan.favoriteIds, ['a']);
});

function deps(overrides: Partial<FavoritesMigrationDeps> = {}) {
  const state = { done: false, applied: [] as string[][], waited: 0 };
  const base: FavoritesMigrationDeps = {
    isDone: () => state.done,
    markDone: () => {
      state.done = true;
    },
    waitForLegacyImport: async () => {
      state.waited += 1;
    },
    listLibrary: async () => [item('v1-a', 'https://site.example/v'), item('solo', 'https://site.example/solo')],
    readLegacyFavoriteDownloadIds: async () => ['v1-a'],
    readPageFavoriteUrls: async () => ['https://site.example/solo'],
    applyFavorites: async (ids) => {
      state.applied.push(ids);
    },
    ...overrides,
  };
  return { deps: base, state };
}

test('the migration runs once, after the v1 import, and is idempotent', async () => {
  const { deps: d, state } = deps();
  const plan = await runFavoritesMigration(d);
  assert.deepEqual([...(plan?.favoriteIds ?? [])].sort(), ['solo', 'v1-a']);
  assert.equal(state.waited, 1, 'waits for the native import of v1 files first');
  assert.deepEqual(state.applied.map((ids) => [...ids].sort()), [['solo', 'v1-a']]);
  assert.equal(state.done, true);

  assert.equal(await runFavoritesMigration(d), null, 'never runs twice');
  assert.equal(state.applied.length, 1);
});

test('a failed run is not marked done, so it is retried at the next start', async () => {
  let fail = true;
  const { deps: d, state } = deps({
    applyFavorites: async (ids) => {
      if (fail) {
        throw new Error('native call failed');
      }
      state.applied.push(ids);
    },
  });
  assert.equal(await runFavoritesMigration(d), null);
  assert.equal(state.done, false);

  fail = false;
  const plan = await runFavoritesMigration(d);
  assert.equal(plan?.favoriteIds.length, 2);
  assert.equal(state.done, true);
});
