import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

/**
 * F16 (#873 Default app, #947 File associations): Android offers VidoraX for video and audio files only through the
 * manifest's VIEW intent filters. This guards them: video/* and audio/* over content: and file:, and no PDF or
 * catch-all type (VidoraX must not ask to open every document).
 */
const manifest = readFileSync(join(process.cwd(), 'android/app/src/main/AndroidManifest.xml'), 'utf8');
const filters = manifest.match(/<intent-filter[\s\S]*?<\/intent-filter>/g) ?? [];
const viewFilters = filters.filter((f) => f.includes('android.intent.action.VIEW'));

describe('the manifest VIEW filters (F16)', () => {
  test('one VIEW filter takes video/* and audio/* over content: and file:', () => {
    const media = viewFilters.find((f) => f.includes('video/*'));
    assert.ok(media, 'a VIEW filter for video/*');
    for (const needle of ['audio/*', 'android:scheme="content"', 'android:scheme="file"', 'android.intent.category.DEFAULT']) {
      assert.ok(media!.includes(needle), `the media filter has ${needle}`);
    }
  });

  test('no VIEW filter claims PDF or every type', () => {
    for (const filter of viewFilters) {
      assert.ok(!filter.includes('application/pdf'), 'no PDF');
      assert.ok(!/android:mimeType="\*\/\*"/.test(filter), 'no */*');
    }
  });
});
