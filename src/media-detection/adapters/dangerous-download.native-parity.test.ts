import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  assessDownloadDanger,
  DANGEROUS_EXTENSIONS,
  DANGEROUS_MIME_TYPES,
  routeRiskyDownload,
} from './dangerous-download';

const NATIVE = join(
  process.cwd(),
  'modules/vidorax-web/android/src/main/java/com/vidorax/web/network/RiskyDownloads.kt',
);

/** The quoted strings of one `val NAME ... = setOf(...)` in the Kotlin source. */
function kotlinSet(source: string, name: string): string[] {
  const start = source.indexOf(`val ${name}`);
  assert.ok(start >= 0, `${name} not found in RiskyDownloads.kt`);
  const open = source.indexOf('setOf(', start);
  const close = source.indexOf(')', open);
  return [...source.slice(open, close).matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

describe('H17 native routing: the Kotlin and JavaScript lists agree', () => {
  const source = readFileSync(NATIVE, 'utf8');

  test('the risky extensions', () => {
    assert.deepEqual(kotlinSet(source, 'EXTENSIONS').sort(), [...DANGEROUS_EXTENSIONS].sort());
  });

  test('the risky MIME types', () => {
    assert.deepEqual(kotlinSet(source, 'MIME_TYPES').sort(), [...DANGEROUS_MIME_TYPES].sort());
  });
});

describe('routeRiskyDownload', () => {
  const RISKY = { url: 'https://example.com/app.apk', contentDisposition: null, mimeType: null, hint: 'risky' };

  test('a routed file is never taken for a video and always warns', () => {
    assert.equal(assessDownloadDanger(RISKY).dangerous, true);
  });

  test('confirmed: handed to the system downloader once', async () => {
    let handed = 0;
    const result = await routeRiskyDownload(RISKY, async () => true, async () => {
      handed += 1;
    });
    assert.equal(result, true);
    assert.equal(handed, 1);
  });

  test('cancelled, dismissed or a failing dialog: dropped, nothing is downloaded', async () => {
    for (const confirm of [async () => false, async () => Promise.reject(new Error('gone'))]) {
      let handed = 0;
      const result = await routeRiskyDownload(RISKY, confirm, async () => {
        handed += 1;
      });
      assert.equal(result, false);
      assert.equal(handed, 0);
    }
  });
});
