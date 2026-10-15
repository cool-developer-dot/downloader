import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  allowSystemDownload,
  assessDownloadDanger,
  DANGEROUS_EXTENSIONS,
  fileExtension,
  fileNameFromContentDisposition,
  fileNameFromUrl,
} from './dangerous-download';

const BASE = { contentDisposition: null, mimeType: 'application/octet-stream', hint: 'unknown' };

describe('assessDownloadDanger', () => {
  test('every listed extension is dangerous, from the URL', () => {
    assert.deepEqual([...DANGEROUS_EXTENSIONS].sort(), [
      'apk', 'apks', 'bat', 'cmd', 'dex', 'exe', 'jar', 'msi', 'scr', 'sh', 'vbs', 'xapk',
    ]);
    for (const ext of DANGEROUS_EXTENSIONS) {
      const verdict = assessDownloadDanger({ ...BASE, url: `https://files.example.com/dl/tool.${ext}` });
      assert.equal(verdict.dangerous, true, ext);
      assert.equal(verdict.reason, 'extension');
      assert.equal(verdict.fileName, `tool.${ext}`);
    }
  });

  test('the extension check ignores case and the query string', () => {
    const verdict = assessDownloadDanger({ ...BASE, url: 'https://example.com/App.APK?token=abc' });
    assert.equal(verdict.dangerous, true);
    assert.equal(verdict.fileName, 'App.APK');
  });

  test('Content-Disposition names the file and wins over the URL', () => {
    const verdict = assessDownloadDanger({
      ...BASE,
      url: 'https://example.com/download.php?id=7',
      contentDisposition: 'attachment; filename="Setup Wizard.exe"',
    });
    assert.deepEqual(verdict, { dangerous: true, fileName: 'Setup Wizard.exe', reason: 'extension' });
  });

  test('a dangerous MIME type is enough', () => {
    for (const mimeType of ['application/vnd.android.package-archive', 'application/x-msdownload; charset=binary',
      'application/java-archive', 'application/x-sh', 'APPLICATION/X-MSI']) {
      const verdict = assessDownloadDanger({ ...BASE, url: 'https://example.com/get', mimeType });
      assert.equal(verdict.dangerous, true, mimeType);
      assert.equal(verdict.reason, 'mime');
    }
  });

  test('ordinary files are not dangerous', () => {
    for (const url of ['https://example.com/report.pdf', 'https://example.com/photos.zip',
      'https://example.com/readme.txt', 'https://example.com/get', 'https://example.com/apk-guide.html',
      'https://example.com/shell.shtml', 'https://example.com/.sh']) {
      assert.equal(assessDownloadDanger({ ...BASE, url }).dangerous, false, url);
    }
  });

  test('videos are never affected, whatever their name', () => {
    assert.equal(assessDownloadDanger({ ...BASE, url: 'https://example.com/clip.exe', hint: 'progressive' }).dangerous, false);
    assert.equal(
      assessDownloadDanger({ url: 'https://example.com/clip.apk', contentDisposition: null, mimeType: 'video/mp4' }).dangerous,
      false,
    );
    assert.equal(
      assessDownloadDanger({ ...BASE, url: 'https://example.com/a.sh', mimeType: 'application/vnd.apple.mpegurl' }).dangerous,
      false,
    );
    assert.equal(assessDownloadDanger({ ...BASE, url: 'https://example.com/a.jar', hint: 'manifest-dash' }).dangerous, false);
  });

  test('a malformed URL is not an error', () => {
    assert.deepEqual(assessDownloadDanger({ ...BASE, url: 'not a url' }), { dangerous: false, fileName: '', reason: null });
  });
});

describe('file name helpers', () => {
  test('Content-Disposition forms', () => {
    assert.equal(fileNameFromContentDisposition('attachment; filename=app.apk'), 'app.apk');
    assert.equal(fileNameFromContentDisposition('attachment; filename="my app.apk"'), 'my app.apk');
    assert.equal(fileNameFromContentDisposition("attachment; filename*=UTF-8''%D8%A7%D9%BE.apk"), 'اپ.apk');
    assert.equal(
      fileNameFromContentDisposition('attachment; filename="fallback.bin"; filename*=UTF-8\'\'real.exe'),
      'real.exe',
    );
    assert.equal(fileNameFromContentDisposition('inline'), null);
    assert.equal(fileNameFromContentDisposition(null), null);
  });

  test('URL names and extensions', () => {
    assert.equal(fileNameFromUrl('https://example.com/a/b/My%20Tool.exe?x=1'), 'My Tool.exe');
    assert.equal(fileNameFromUrl('https://example.com/'), null);
    assert.equal(fileExtension('archive.tar.SH'), 'sh');
    assert.equal(fileExtension('.bashrc'), null);
    assert.equal(fileExtension('noext'), null);
    assert.equal(fileExtension('trailing.'), null);
  });
});

describe('allowSystemDownload', () => {
  test('a harmless file goes through without asking', async () => {
    let asked = false;
    const allowed = await allowSystemDownload({ ...BASE, url: 'https://example.com/a.pdf' }, async () => {
      asked = true;
      return false;
    });
    assert.equal(allowed, true);
    assert.equal(asked, false);
  });

  test('a dangerous file asks, naming the file, and follows the answer', async () => {
    const names: string[] = [];
    const confirm = (answer: boolean) => async (name: string) => {
      names.push(name);
      return answer;
    };
    assert.equal(await allowSystemDownload({ ...BASE, url: 'https://example.com/x.apk' }, confirm(true)), true);
    assert.equal(await allowSystemDownload({ ...BASE, url: 'https://example.com/x.apk' }, confirm(false)), false);
    assert.deepEqual(names, ['x.apk', 'x.apk']);
  });

  test('a dialog that fails counts as Cancel', async () => {
    const allowed = await allowSystemDownload({ ...BASE, url: 'https://example.com/x.exe' }, async () => {
      throw new Error('no activity');
    });
    assert.equal(allowed, false);
  });
});
