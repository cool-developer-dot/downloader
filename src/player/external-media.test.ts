import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import type { IncomingMedia, LibraryItem } from '@modules/vidorax-media/src/VidoraMedia.types';

import {
  canOpenIncomingMedia,
  createIncomingMediaQueue,
  externalMediaId,
  externalTokenOf,
  forgetIncomingMediaForTests,
  isExternalMediaId,
  isIncomingFileLink,
  knownIncomingMedia,
  saveOutcomeFrom,
} from './external-media';
import { assertSafeMediaId } from './media-id';

const TOKEN = '0123456789abcdef0123456789abcdef';
const media = (token = TOKEN, name: string | null = 'clip.mp4'): IncomingMedia => ({
  token,
  displayName: name,
  mimeType: 'video/mp4',
  sizeBytes: 1_000,
  kind: 'video',
});
const OPEN = { shellReady: true, appLockEnabled: false, unlocked: true };

beforeEach(() => forgetIncomingMediaForTests());

test('an incoming file is an `external:` media id the player route accepts, never a path', () => {
  const id = externalMediaId(TOKEN);
  assert.equal(id, `external:${TOKEN}`);
  assert.equal(assertSafeMediaId(id), id);
  assert.equal(isExternalMediaId(id), true);
  assert.equal(externalTokenOf(id), TOKEN);
  assert.equal(isExternalMediaId('device:42'), false);
  assert.equal(isExternalMediaId('3f1c-download-id'), false);
  assert.equal(externalTokenOf('external:../../secret'), null);
  assert.equal(externalTokenOf(`external:${TOKEN.toUpperCase()}`), null);
  assert.throws(() => externalMediaId('content://media/external/video/1'));
});

test('content: and file: links are files for the module, not routes', () => {
  assert.equal(isIncomingFileLink('content://com.android.providers.downloads.documents/document/42'), true);
  assert.equal(isIncomingFileLink(' FILE:///sdcard/Download/a.mp4'), true);
  assert.equal(isIncomingFileLink('https://example.com/a.mp4'), false);
  assert.equal(isIncomingFileLink('vidorax://library'), false);
  assert.equal(isIncomingFileLink('/library'), false);
  assert.equal(isIncomingFileLink(null), false);
});

test('a file opens only once the shell is up and App Lock, when on, is unlocked', () => {
  assert.equal(canOpenIncomingMedia(OPEN), true);
  assert.equal(canOpenIncomingMedia({ ...OPEN, shellReady: false }), false);
  assert.equal(canOpenIncomingMedia({ shellReady: true, appLockEnabled: true, unlocked: false }), false);
  assert.equal(canOpenIncomingMedia({ shellReady: true, appLockEnabled: true, unlocked: true }), true);
});

test('the queue holds the file behind the PIN and opens it once after unlocking', () => {
  const queue = createIncomingMediaQueue();
  let notified = 0;
  queue.subscribe(() => {
    notified += 1;
  });
  assert.equal(queue.capture(media()), true);
  assert.equal(notified, 1);

  const locked = { shellReady: true, appLockEnabled: true, unlocked: false };
  assert.equal(queue.takeIfAllowed(locked), null);
  assert.equal(queue.hasPending(), true);

  const id = queue.takeIfAllowed({ ...locked, unlocked: true });
  assert.equal(id, `external:${TOKEN}`);
  assert.equal(knownIncomingMedia(id!)?.displayName, 'clip.mp4');
  assert.equal(queue.takeIfAllowed(OPEN), null, 'opened once');
  assert.equal(queue.hasPending(), false);
});

test('a newer file replaces one that has not opened yet; malformed tokens are ignored', () => {
  const queue = createIncomingMediaQueue();
  const other = 'ffffffffffffffffffffffffffffffff';
  queue.capture(media());
  queue.capture(media(other, 'second.mkv'));
  assert.equal(queue.capture(media('not-a-token')), false);
  assert.equal(queue.capture(null), false);
  assert.equal(queue.takeIfAllowed(OPEN), `external:${other}`);
});

test('the save result becomes what the Player says', () => {
  const item = { id: 'lib-1' } as LibraryItem;
  assert.deepEqual(saveOutcomeFrom({ status: 'imported', item }, null), { kind: 'saved', libraryItemId: 'lib-1' });
  assert.deepEqual(saveOutcomeFrom({ status: 'duplicate', libraryItemId: 'lib-0', galleryUri: null }, null), {
    kind: 'duplicate',
    libraryItemId: 'lib-0',
  });
  assert.deepEqual(saveOutcomeFrom(null, 'ERR_NO_SPACE'), { kind: 'no_space' });
  assert.deepEqual(saveOutcomeFrom(null, 'ERR_NOT_FOUND'), { kind: 'unavailable' });
  assert.deepEqual(saveOutcomeFrom(null, 'ERR_STORAGE'), { kind: 'failed' });
  assert.deepEqual(saveOutcomeFrom(null, null), { kind: 'failed' });
});

test('an audio source is revealed without waiting for a video frame', async () => {
  const { revealsWithoutFirstFrame } = await import('./first-frame-state');
  assert.equal(revealsWithoutFirstFrame('audio/mpeg'), true);
  assert.equal(revealsWithoutFirstFrame(' Audio/MP4 '), true);
  assert.equal(revealsWithoutFirstFrame('video/mp4'), false);
  assert.equal(revealsWithoutFirstFrame(null), false);
});

test('the shell is ready once the splash, first-launch pages and root redirect are gone', async () => {
  const { isAppShellRoute } = await import('./external-media');
  for (const path of ['', '/', '/splash', '/onboarding', '/onboarding/trust', null]) {
    assert.equal(isAppShellRoute(path), false, String(path));
  }
  for (const path of ['/browser', '/downloads', '/library', '/player/abc', '/settings']) {
    assert.equal(isAppShellRoute(path), true, path);
  }
});
