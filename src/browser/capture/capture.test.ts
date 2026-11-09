import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';

import { DATABASE_VERSION, TABLE_NAMES } from '@/storage/constants';
import { deleteSavedPage, insertSavedPage, listSavedPages } from '@/storage/repositories/saved-pages.queries';
import { migrateDatabase } from '@/storage/sqlite/migrations';
import { applyBrowserTables } from '@/storage/sqlite/schema';
import { buildBrowserChromeInjectedScript } from '@/browser/bridge/browser-chrome.injected';

import {
  downloadableImageSrc,
  formatBytes,
  isPdfChoice,
  offlineMarker,
  offlineProfileKey,
  pageHeight,
  pdfFailureKey,
  savedPageIdOf,
  stepZoom,
} from './capture-core.ts';

type Param = string | number | null;

function openDb() {
  const sqlite = new DatabaseSync(':memory:');
  const db = {
    async execAsync(sql: string) {
      sqlite.exec(sql);
    },
    async runAsync(sql: string, ...params: Param[]) {
      return { changes: Number(sqlite.prepare(sql).run(...params).changes) };
    },
    async getAllAsync<T>(sql: string, ...params: Param[]) {
      return sqlite.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, ...params: Param[]) {
      return (sqlite.prepare(sql).get(...params) ?? null) as T | null;
    },
    async withTransactionAsync(task: () => Promise<void>) {
      await task();
    },
  };
  return { sqlite, db };
}

describe('B17 #178 saved pages (DATABASE_VERSION 8 and later)', () => {
  test('a v7 database gets the table, keeps its data, and running it twice changes nothing', async () => {
    const { sqlite, db } = openDb();
    await migrateDatabase(db as never);
    assert.ok(DATABASE_VERSION >= 8);
    sqlite.exec(`DROP TABLE ${TABLE_NAMES.savedPages}; PRAGMA user_version = 7`);
    sqlite.prepare(`INSERT INTO ${TABLE_NAMES.highlights} (id, page_url, exact, created_at) VALUES ('h', 'https://x.test/', 'kept', 'x')`).run();
    await migrateDatabase(db as never);
    sqlite.exec('PRAGMA user_version = 7');
    await migrateDatabase(db as never);
    await applyBrowserTables(db as never);
    assert.equal((sqlite.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, DATABASE_VERSION);
    assert.equal((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${TABLE_NAMES.highlights}`).get() as { n: number }).n, 1);
  });

  test('add, list newest first, delete', async () => {
    const { db } = openDb();
    await applyBrowserTables(db as never);
    await insertSavedPage(db, { id: 'a', url: 'https://x.test/a', title: 'A', size: 1000, createdAt: '2026-11-10T10:00:00Z' });
    await insertSavedPage(db, { id: 'b', url: 'https://x.test/b', title: 'B', size: 2048.6, createdAt: '2026-11-10T11:00:00Z' });
    assert.deepEqual((await listSavedPages(db)).map((p) => [p.id, p.size]), [['b', 2049], ['a', 1000]]);
    assert.equal(await deleteSavedPage(db, 'a'), true);
    assert.deepEqual((await listSavedPages(db)).map((p) => p.id), ['b']);
  });

  test('the reading-list marker and profile folders', () => {
    assert.equal(offlineMarker('abc-1'), 'vidorax://offline/abc-1');
    assert.equal(savedPageIdOf('vidorax://offline/abc-1'), 'abc-1');
    assert.equal(savedPageIdOf('vidorax://offline/../x'), null);
    assert.equal(savedPageIdOf('https://x.test/'), null);
    assert.equal(savedPageIdOf(null), null);
    assert.equal(offlineProfileKey('default'), 'default');
    assert.equal(offlineProfileKey('a/b c'), 'a_b_c');
    assert.equal(offlineProfileKey(''), 'default');
    assert.equal(formatBytes(1536), '2 KB');
    assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
  });
});

describe('B17 #264 / #265 PDFs', () => {
  test('choices, failures, zoom steps and the fixed page layout', () => {
    assert.ok(isPdfChoice('ask') && isPdfChoice('viewer') && isPdfChoice('download') && isPdfChoice('external'));
    assert.ok(!isPdfChoice('other'));
    assert.equal(pdfFailureKey('notPdf'), 'browserCapture.pdfNotPdf');
    assert.equal(pdfFailureKey('tooLarge'), 'browserCapture.pdfTooLarge');
    assert.equal(pdfFailureKey('protected'), 'browserCapture.pdfProtected');
    assert.equal(pdfFailureKey('network'), 'browserCapture.pdfFailed');
    assert.equal(stepZoom(1, 1), 1.5);
    assert.equal(stepZoom(3, 1), 3);
    assert.equal(stepZoom(1, -1), 1);
    assert.equal(stepZoom(2, -1), 1.5);
    assert.equal(pageHeight([612, 792], 360), 466);
    assert.equal(pageHeight([0, 0], 360), 360);
  });
});

describe('B17 #280 download image', () => {
  test('only http(s) pictures can be downloaded', () => {
    assert.equal(downloadableImageSrc('https://x.test/a.jpg'), 'https://x.test/a.jpg');
    assert.equal(downloadableImageSrc('data:image/png;base64,AAA'), null);
    assert.equal(downloadableImageSrc('blob:https://x.test/1'), null);
    assert.equal(downloadableImageSrc(42), null);
  });

  test('a long-pressed image (no link) reports its current source; the script compiles', () => {
    const script = buildBrowserChromeInjectedScript();
    assert.doesNotThrow(() => new vm.Script(script));
    const posted: { type: string; payload: Record<string, unknown> }[] = [];
    const listeners: Record<string, (e: unknown) => void> = {};
    const timers: (() => void)[] = [];
    const img = { tagName: 'IMG', currentSrc: 'https://x.test/photo.jpg', src: 'https://x.test/small.jpg', parentElement: null };
    const context = {
      window: {
        ReactNativeWebView: { postMessage: (m: string) => posted.push(JSON.parse(m)) },
        addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
        scrollY: 0,
        innerHeight: 800,
      },
      document: {
        addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
        documentElement: { scrollHeight: 1000 },
      },
      location: { href: 'https://x.test/page' },
      setTimeout: (fn: () => void) => {
        timers.push(fn);
        return timers.length;
      },
      clearTimeout: () => undefined,
      JSON,
      Math,
    };
    vm.runInNewContext(script, context);
    const contextMenu = listeners.contextmenu;
    assert.ok(contextMenu, 'listens for long presses');
    contextMenu({ target: img, clientX: 5, clientY: 6, preventDefault() {}, stopPropagation() {} });
    const message = posted.map((p) => (typeof p === 'object' && 'payload' in p ? p : JSON.parse(String(p)))).find((p) => p.type === 'link_long_press');
    assert.ok(message, 'posted a long press');
    assert.equal(message.payload.href, '');
    assert.equal(message.payload.imageSrc, 'https://x.test/photo.jpg');
  });
});
