import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isPlayStoreListingUrl,
  openPlayStoreListingWith,
  PLAY_STORE_LISTING_URLS,
  PLAY_STORE_PACKAGE_ID,
  playStoreListingUrls,
} from './play-store-listing.ts';

test('the listing points at the VidoraX Play package', () => {
  assert.equal(PLAY_STORE_PACKAGE_ID, 'com.vidorax.fast.videodownloader');
  assert.deepEqual(PLAY_STORE_LISTING_URLS, {
    app: 'market://details?id=com.vidorax.fast.videodownloader',
    web: 'https://play.google.com/store/apps/details?id=com.vidorax.fast.videodownloader',
  });
});

test('package ids are trimmed and encoded', () => {
  assert.equal(playStoreListingUrls(' a.b c ').app, 'market://details?id=a.b%20c');
});

test('Rate / Check for Updates are available only for a real URL', () => {
  assert.equal(isPlayStoreListingUrl(PLAY_STORE_LISTING_URLS.web), true);
  assert.equal(isPlayStoreListingUrl(null), false);
  assert.equal(isPlayStoreListingUrl(undefined), false);
  assert.equal(isPlayStoreListingUrl('   '), false);
});

test('opens the Play Store app first', async () => {
  const opened: string[] = [];
  const result = await openPlayStoreListingWith(async (url) => {
    opened.push(url);
  });
  assert.equal(result, 'play_store_app');
  assert.deepEqual(opened, [PLAY_STORE_LISTING_URLS.app]);
});

test('falls back to the web listing when no app handles market:', async () => {
  const opened: string[] = [];
  const result = await openPlayStoreListingWith(async (url) => {
    opened.push(url);
    if (url.startsWith('market:')) {
      throw new Error('No Activity found to handle Intent');
    }
  });
  assert.equal(result, 'web');
  assert.deepEqual(opened, [PLAY_STORE_LISTING_URLS.app, PLAY_STORE_LISTING_URLS.web]);
});

test('reports failure when neither opens, without throwing', async () => {
  const result = await openPlayStoreListingWith(async () => {
    throw new Error('nothing');
  });
  assert.equal(result, 'failed');
});
