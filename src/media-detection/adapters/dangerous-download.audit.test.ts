import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createSystemDownloadGate } from './dangerous-download';

const APK = { url: 'https://example.com/app.apk', contentDisposition: null, mimeType: 'application/octet-stream', hint: 'unknown' };

describe('createSystemDownloadGate', () => {
  test('a repeated event for a file whose warning is open is dropped; the first answer decides', async () => {
    let asked = 0;
    let answer: (value: boolean) => void = () => {};
    const gate = createSystemDownloadGate(
      () =>
        new Promise<boolean>((resolve) => {
          asked += 1;
          answer = resolve;
        }),
    );
    const first = gate(APK);
    const repeat = await gate(APK);
    assert.equal(repeat, false);
    answer(true);
    assert.equal(await first, true);
    assert.equal(asked, 1);
  });

  test('after the warning closes, the same file can be asked about again', async () => {
    let asked = 0;
    const gate = createSystemDownloadGate(async () => {
      asked += 1;
      return false;
    });
    assert.equal(await gate(APK), false);
    assert.equal(await gate(APK), false);
    assert.equal(asked, 2);
  });

  test('harmless files pass at once and never open a warning', async () => {
    let asked = 0;
    const gate = createSystemDownloadGate(async () => {
      asked += 1;
      return false;
    });
    assert.equal(await gate({ ...APK, url: 'https://example.com/a.pdf' }), true);
    assert.equal(asked, 0);
  });
});

describe('displayFileName', () => {
  test('direction overrides and control characters cannot disguise the extension', async () => {
    const { displayFileName, assessDownloadDanger } = await import('./dangerous-download');
    const spoof = 'photo‮gpj.exe';
    assert.equal(displayFileName(spoof), 'photogpj.exe');
    assert.equal(assessDownloadDanger({ url: `https://x.com/${encodeURIComponent(spoof)}`, contentDisposition: null, mimeType: null }).dangerous, true);
    assert.equal(displayFileName('a\u0000b⁦c'), 'abc');
  });

  test('long names keep their extension visible; Urdu stays whole', async () => {
    const { displayFileName } = await import('./dangerous-download');
    const shown = displayFileName(`${'x'.repeat(200)}.apk`);
    assert.ok(shown.endsWith('.apk'));
    assert.ok(Array.from(shown).length <= 80);
    assert.equal(displayFileName('میری ایپ.apk'), 'میری ایپ.apk');
  });
});
