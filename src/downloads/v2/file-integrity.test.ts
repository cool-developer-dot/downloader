import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import type { PlayableSource, RepairOutcome } from '@modules/vidorax-media/src/VidoraMedia.types';

import { setV2EngineForTests, type V2EnginePort } from './engine-port';
import {
  canOfferRepair,
  checksumPercent,
  fileIntegrity,
  groupSha256,
  isPlayable,
  isSha256,
  mayPlayWhileDownloading,
  playableUri,
  REPAIR_MESSAGE_KEYS,
  repairMessageKey,
  storedChecksum,
  type FileIntegrityPort,
} from './file-integrity';

afterEach(() => setV2EngineForTests(null));

const HASH = 'ab'.repeat(32);

describe('checksum verify (#409)', () => {
  test('only a lowercase SHA-256 hex digest is a checksum', () => {
    assert.equal(isSha256(HASH), true);
    for (const value of [HASH.toUpperCase(), HASH.slice(1), `${HASH}0`, 'z'.repeat(64), null, 42]) {
      assert.equal(isSha256(value), false, String(value));
    }
    assert.equal(groupSha256(HASH), `${'abababab '.repeat(7)}abababab`);
    assert.equal(groupSha256('nope'), 'nope');
  });

  test('progress is a whole percent, or unknown', () => {
    assert.equal(checksumPercent({ bytesDone: 512, totalBytes: 1024 }), 50);
    assert.equal(checksumPercent({ bytesDone: 2048, totalBytes: 1024 }), 100);
    assert.equal(checksumPercent({ bytesDone: 1, totalBytes: 0 }), null);
    assert.equal(checksumPercent(null), null);
  });

  test('the stored hash is read as native code has it; an older build or a bad answer is none', async () => {
    assert.equal(await storedChecksum(null, 'v'), null);
    assert.equal(await storedChecksum({}, 'v'), null);
    const port: FileIntegrityPort = { getChecksum: async () => ({ sha256: HASH, computing: false }) };
    assert.deepEqual(await storedChecksum(port, 'v'), { sha256: HASH, computing: false });
    const odd: FileIntegrityPort = { getChecksum: async () => ({ sha256: 'not-hex', computing: true }) };
    assert.deepEqual(await storedChecksum(odd, 'v'), { sha256: null, computing: true });
    const failing: FileIntegrityPort = {
      getChecksum: async () => {
        throw new Error('gone');
      },
    };
    assert.equal(await storedChecksum(failing, 'v'), null);
  });
});

describe('repair partial file (#412)', () => {
  test('offered only for a failed download with a partial file', () => {
    assert.equal(canOfferRepair('FAILED', { partialBytes: 1 }), true);
    assert.equal(canOfferRepair('FAILED', { partialBytes: 0 }), false);
    assert.equal(canOfferRepair('FAILED', null), false);
    for (const status of ['COMPLETED', 'PAUSED', 'DOWNLOADING', 'QUEUED', 'CANCELLED']) {
      assert.equal(canOfferRepair(status, { partialBytes: 100 }), false, status);
    }
  });

  test('every native outcome has its message; anything else is the failure message', () => {
    const outcomes: RepairOutcome[] = [
      'resumed',
      'restarted_changed',
      'restarted_corrupt',
      'restarted_no_resume',
      'segment_refetched',
      'unreachable',
      'nothing',
    ];
    assert.deepEqual(Object.keys(REPAIR_MESSAGE_KEYS).sort(), [...outcomes].sort());
    for (const outcome of outcomes) {
      assert.equal(repairMessageKey(outcome), REPAIR_MESSAGE_KEYS[outcome]);
    }
    assert.equal(repairMessageKey('exploded'), 'fileIntegrity.repairFailed');
    assert.equal(repairMessageKey(undefined), 'fileIntegrity.repairFailed');
  });
});

describe('play while downloading (#411)', () => {
  test('asked only for a download still downloading, never while it is processed', () => {
    for (const status of ['DOWNLOADING', 'PAUSED', 'QUEUED']) {
      assert.equal(mayPlayWhileDownloading(status, 'TRANSFERRING'), true, status);
    }
    assert.equal(mayPlayWhileDownloading('DOWNLOADING', 'VERIFYING'), false, 'merging, remuxing or checking');
    for (const status of ['COMPLETED', 'FAILED', 'CANCELLED', null]) {
      assert.equal(mayPlayWhileDownloading(status, null), false, String(status));
    }
  });

  test('the getPlayableSource contract: a playable answer has a size, the URI is VidoraX’s own provider', () => {
    const source: PlayableSource = {
      playable: true,
      uri: `content://com.vidorax.fast.videodownloader.vidorax.growing/v/${'0f'.repeat(16)}`,
      playableBytes: 3_000_000,
      totalBytes: 50_000_000,
      mimeType: 'video/mp4',
    };
    assert.equal(isPlayable(source), true);
    assert.equal(playableUri(source), source.uri);
    assert.equal(isPlayable({ playable: false, reason: 'stream' }), false);
    assert.equal(playableUri({ playable: false, reason: 'not_enough_bytes' }), null);
    assert.equal(isPlayable({ ...source, totalBytes: 0 }), false);
    for (const uri of [
      'file:///data/user/0/x/no_backup/work/dl/download.part',
      'content://com.other.app.provider/v/0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f',
      'content://x.vidorax.growing/v/short',
      'https://example.com/v.mp4',
    ]) {
      assert.equal(playableUri({ ...source, uri }), null, uri);
    }
  });

  test('without the native module nothing is offered', () => {
    setV2EngineForTests(null);
    assert.equal(fileIntegrity(), null);
    setV2EngineForTests({} as V2EnginePort);
    assert.equal(fileIntegrity()?.checkPlayable, undefined);
  });
});
