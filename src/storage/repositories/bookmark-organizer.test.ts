import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { bookmarkFileHtml, parseBookmarkFile } from '@/browser/bookmarks/netscape-import';
import { DATABASE_VERSION, TABLE_NAMES } from '@/storage/constants';
import { migrateDatabase } from '@/storage/sqlite/migrations';
import { applyBrowserTables } from '@/storage/sqlite/schema';

import {
  addBookmarkToFolder,
  addToReadingList,
  BOOKMARKS_BAR_FOLDER_ID,
  createFolder,
  countInFolder,
  deleteFolder,
  ensureBookmarksBarFolder,
  exportTree,
  folderPath,
  importChunk,
  importPathKey,
  listFolderContents,
  listReadingList,
  listTags,
  moveBookmark,
  moveFolder,
  OrganizerError,
  searchBookmarks,
  setOrder,
  setReadingOfflineCopy,
  setReadingRead,
  updateBookmarkDetails,
  type ImportContext,
  type OrganizerDb,
} from './bookmark-organizer.queries.ts';

type Param = string | number | null;

/** expo-sqlite's async API over Node's SQLite (foreign keys on, as configureDatabasePragmas does). */
function openDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
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
      sqlite.exec('BEGIN');
      try {
        await task();
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sqlite, db };
}

/** The bookmarks table exactly as v1 / v2 created it (before B9). */
const V2_BOOKMARKS = `
  CREATE TABLE ${TABLE_NAMES.bookmarks} (
    id TEXT PRIMARY KEY NOT NULL,
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    hostname TEXT NOT NULL,
    favicon_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`;

async function freshDb() {
  const { sqlite, db } = openDb();
  await applyBrowserTables(db as never);
  return { sqlite, db: db as unknown as OrganizerDb & typeof db };
}

let counter = 0;
const newId = async () => `id-${++counter}`;
const NOW = '2026-11-08T12:00:00.000Z';

describe('B9 migration v2 → v3 (15 old bookmarks, real SQLite)', () => {
  async function oldDatabase() {
    const { sqlite, db } = openDb();
    sqlite.exec(V2_BOOKMARKS);
    const insert = sqlite.prepare(
      `INSERT INTO ${TABLE_NAMES.bookmarks} (id, url, title, hostname, favicon_url, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    );
    for (let i = 0; i < 15; i++) {
      const at = new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
      insert.run(`old-${i}`, `https://site${i}.test/`, `Site ${i}`, `site${i}.test`, at, at);
    }
    sqlite.exec('PRAGMA user_version = 2');
    return { sqlite, db };
  }
  const order = (sqlite: DatabaseSync) =>
    (sqlite.prepare(`SELECT id FROM ${TABLE_NAMES.bookmarks} ORDER BY position`).all() as { id: string }[]).map((r) => r.id);

  test('every bookmark is kept, in the root folder, in today’s order (newest first); version 3 or later', async () => {
    const { sqlite, db } = await oldDatabase();
    await migrateDatabase(db as never);
    // B9 made it 3; later packages go on from there (B14: 4) and the migration runs every step.
    assert.ok(DATABASE_VERSION >= 3);
    assert.equal((sqlite.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, DATABASE_VERSION);
    assert.deepEqual(
      order(sqlite),
      Array.from({ length: 15 }, (_, i) => `old-${14 - i}`),
    );
    const rows = sqlite.prepare(`SELECT folder_id, note, title FROM ${TABLE_NAMES.bookmarks}`).all() as {
      folder_id: string | null;
      note: string;
      title: string;
    }[];
    assert.equal(rows.length, 15);
    assert.ok(rows.every((r) => r.folder_id === null && r.note === ''));
    const contents = await listFolderContents(db as never, null);
    assert.deepEqual(contents.bookmarks.map((b) => b.id), Array.from({ length: 15 }, (_, i) => `old-${14 - i}`));
  });

  test('running it twice (and the profile-database path every open) changes nothing', async () => {
    const { sqlite, db } = await oldDatabase();
    await migrateDatabase(db as never);
    // A user reorder after the upgrade must survive the next open.
    sqlite.prepare(`UPDATE ${TABLE_NAMES.bookmarks} SET position = 99 WHERE id = 'old-0'`).run();
    const before = order(sqlite);
    sqlite.exec('PRAGMA user_version = 2');
    await migrateDatabase(db as never);
    await applyBrowserTables(db as never);
    await applyBrowserTables(db as never);
    assert.deepEqual(order(sqlite), before);
    const columns = (sqlite.prepare(`PRAGMA table_info(${TABLE_NAMES.bookmarks})`).all() as { name: string }[]).map((c) => c.name);
    assert.equal(columns.filter((c) => c === 'position').length, 1);
    assert.ok(['folder_id', 'note', 'position'].every((c) => columns.includes(c)));
    assert.equal((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${TABLE_NAMES.bookmarks}`).get() as { n: number }).n, 15);
  });

  test('a fresh install gets the current version with the new tables', async () => {
    const { sqlite, db } = openDb();
    await migrateDatabase(db as never);
    assert.equal((sqlite.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, DATABASE_VERSION);
    const tables = (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name);
    for (const name of [TABLE_NAMES.bookmarkFolders, TABLE_NAMES.bookmarkTags, TABLE_NAMES.readingList]) assert.ok(tables.includes(name), name);
  });
});

describe('B9 folders, order, tags, notes (real SQLite)', () => {
  test('#77 create, nest, breadcrumbs, move; never into itself', async () => {
    const { db } = await freshDb();
    const news = await createFolder(db, { id: 'news', parentId: null, name: '  News  ', nowIso: NOW });
    const urdu = await createFolder(db, { id: 'urdu', parentId: 'news', name: 'اردو', nowIso: NOW });
    assert.equal(news.name, 'News');
    assert.deepEqual((await folderPath(db, 'urdu')).map((f) => f.name), ['News', 'اردو']);
    await assert.rejects(moveFolder(db, 'news', 'urdu', NOW), (e: OrganizerError) => e.code === 'CYCLE');
    await assert.rejects(createFolder(db, { id: 'x', parentId: null, name: '   ', nowIso: NOW }), (e: OrganizerError) => e.code === 'INVALID_NAME');
    await moveFolder(db, 'urdu', null, NOW);
    assert.deepEqual((await listFolderContents(db, null)).folders.map((f) => f.id), ['news', urdu.id]);
  });

  test('#80 order inside a folder; unpositioned (starred) bookmarks first, newest first', async () => {
    const { sqlite, db } = await freshDb();
    for (const i of [1, 2, 3]) {
      await addBookmarkToFolder(db, { id: `b${i}`, url: `https://b${i}.test/`, title: `B${i}`, folderId: null, createdAtIso: NOW, nowIso: NOW });
    }
    await setOrder(db, null, 'bookmarks', ['b3', 'b1', 'b2']);
    // The browser's star adds without a position (the existing repository).
    sqlite.prepare(
      `INSERT INTO ${TABLE_NAMES.bookmarks} (id, url, title, hostname, created_at, updated_at) VALUES ('star', 'https://star.test/', 'S', 'star.test', '2026-11-09T00:00:00Z', '2026-11-09T00:00:00Z')`,
    ).run();
    assert.deepEqual((await listFolderContents(db, null)).bookmarks.map((b) => b.id), ['star', 'b3', 'b1', 'b2']);
  });

  test('#77 delete a folder: move its contents up, or delete them (tags go too)', async () => {
    const { sqlite, db } = await freshDb();
    await createFolder(db, { id: 'a', parentId: null, name: 'A', nowIso: NOW });
    await createFolder(db, { id: 'a1', parentId: 'a', name: 'A1', nowIso: NOW });
    await addBookmarkToFolder(db, { id: 'x', url: 'https://x.test/', title: 'X', folderId: 'a', createdAtIso: NOW, nowIso: NOW, tags: ['t'] });
    await addBookmarkToFolder(db, { id: 'y', url: 'https://y.test/', title: 'Y', folderId: 'a1', createdAtIso: NOW, nowIso: NOW });
    assert.deepEqual(await countInFolder(db, 'a'), { bookmarks: 2, folders: 1 });
    await deleteFolder(db, 'a', 'moveUp');
    const root = await listFolderContents(db, null);
    assert.deepEqual(root.folders.map((f) => f.id), ['a1']);
    assert.deepEqual(root.bookmarks.map((b) => b.id), ['x']);
    await deleteFolder(db, 'a1', 'deleteAll');
    assert.equal((await listFolderContents(db, null)).folders.length, 0);
    assert.equal((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${TABLE_NAMES.bookmarks} WHERE id = 'y'`).get() as { n: number }).n, 0);
    await moveBookmark(db, 'x', null, NOW);
    sqlite.prepare(`DELETE FROM ${TABLE_NAMES.bookmarks} WHERE id = 'x'`).run();
    assert.equal((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${TABLE_NAMES.bookmarkTags}`).get() as { n: number }).n, 0);
  });

  test('#78 edit: title, checked address, folder, tags, note; #92 #93 search includes tags and notes', async () => {
    const { db } = await freshDb();
    await createFolder(db, { id: 'f', parentId: null, name: 'F', nowIso: NOW });
    await addBookmarkToFolder(db, { id: 'p', url: 'https://p.test/', title: 'P', folderId: null, createdAtIso: NOW, nowIso: NOW });
    await addBookmarkToFolder(db, { id: 'q', url: 'https://q.test/', title: 'Q', folderId: null, createdAtIso: NOW, nowIso: NOW });
    await assert.rejects(
      updateBookmarkDetails(db, 'p', { title: 'P', url: 'javascript:x', folderId: null, note: '', tags: [], nowIso: NOW }),
      (e: OrganizerError) => e.code === 'INVALID_URL',
    );
    await assert.rejects(
      updateBookmarkDetails(db, 'p', { title: 'P', url: 'https://q.test/', folderId: null, note: '', tags: [], nowIso: NOW }),
      (e: OrganizerError) => e.code === 'DUPLICATE_URL',
    );
    await updateBookmarkDetails(db, 'p', {
      title: 'Lahore food',
      url: 'https://p.test/food',
      folderId: 'f',
      note: 'Try the nihari لاہور',
      tags: ['food', 'Food', ' travel ', 'a,b'],
      nowIso: NOW,
    });
    const inFolder = (await listFolderContents(db, 'f')).bookmarks[0];
    assert.deepEqual([inFolder.title, inFolder.url, inFolder.note, inFolder.tags], ['Lahore food', 'https://p.test/food', 'Try the nihari لاہور', ['a b', 'food', 'travel']]);
    assert.deepEqual((await searchBookmarks(db, 'nihari', null)).map((b) => b.id), ['p']);
    assert.deepEqual((await searchBookmarks(db, 'TRAVEL', null)).map((b) => b.id), ['p']);
    assert.deepEqual((await searchBookmarks(db, '', 'food')).map((b) => b.id), ['p']);
    assert.deepEqual((await listTags(db)).map((t) => t.tag), ['a b', 'food', 'travel']);
  });

  test('#81 the bookmarks bar folder is made once', async () => {
    const { db } = await freshDb();
    const bar = await ensureBookmarksBarFolder(db, 'Bookmarks bar', NOW);
    const again = await ensureBookmarksBarFolder(db, 'Other name', NOW);
    assert.equal(bar.id, BOOKMARKS_BAR_FOLDER_ID);
    assert.equal(again.name, 'Bookmarks bar');
  });

  test('#89 reading list: unread / read, added again = unread, the B17 offline hook', async () => {
    const { db } = await freshDb();
    assert.equal(await addToReadingList(db, { id: 'r1', url: 'https://read.test/a', title: 'A', nowIso: NOW }), 'added');
    assert.equal(await addToReadingList(db, { id: 'r2', url: 'javascript:x', title: 'B', nowIso: NOW }), 'invalid');
    await setReadingRead(db, 'r1', true, NOW);
    assert.equal((await listReadingList(db, false)).length, 0);
    assert.equal((await listReadingList(db, true))[0].readAt, NOW);
    assert.equal(await addToReadingList(db, { id: 'r3', url: 'https://read.test/a', title: 'A', nowIso: NOW }), 'exists');
    assert.equal((await listReadingList(db, false)).length, 1);
    await setReadingOfflineCopy(db, 'r1', 'file:///data/x/offline/a.mht');
    assert.equal((await listReadingList(db, false))[0].offlineUri, 'file:///data/x/offline/a.mht');
  });
});

describe('B9 #84 / #85 import and export', () => {
  const chromeFile = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://news.ycombinator.com/" ADD_DATE="1700000001" ICON="data:image/png;base64,${'A'.repeat(5000)}">Hacker News</A>
        <dt><a href="https://ur.wikipedia.org/wiki/%D9%84%D8%A7%DB%81%D9%88%D8%B1" add_date="1700000002">لاہور &amp; more</a>
    </DL><p>
    <DT><H3>Other bookmarks</H3>
    <DL><p>
        <DT><A HREF="javascript:void(0)">Bookmarklet</A>
        <DT><A HREF="https://example.com/" ADD_DATE="1700000003" TAGS="demo,test">Example</A>
        <DD>A note &lt;b&gt;here&lt;/b&gt;
        <DT><H3>Empty</H3>
        <DL><p>
        </DL><p>
    </DL><p>
</DL><p>`;

  test('the file is read as text: folders, toolbar flag, dates, tags, notes, entities, invalid entries', () => {
    const parsed = parseBookmarkFile(chromeFile);
    assert.equal(parsed.invalid, 1);
    assert.deepEqual(parsed.folders, [
      { path: ['Bookmarks bar'], isBookmarksBar: true },
      { path: ['Other bookmarks'], isBookmarksBar: false },
      { path: ['Other bookmarks', 'Empty'], isBookmarksBar: false },
    ]);
    assert.deepEqual(
      parsed.bookmarks.map((b) => [b.path.join('/'), b.title, b.addedAt, b.tags, b.note]),
      [
        ['Bookmarks bar', 'Hacker News', '2023-11-14T22:13:21.000Z', [], ''],
        ['Bookmarks bar', 'لاہور & more', '2023-11-14T22:13:22.000Z', [], ''],
        ['Other bookmarks', 'Example', '2023-11-14T22:13:23.000Z', ['demo', 'test'], 'A note <b>here</b>'],
      ],
    );
    assert.equal(parseBookmarkFile('<html><body>hello</body></html>').notBookmarkFile, true);
  });

  async function runImport(db: OrganizerDb, text: string) {
    const parsed = parseBookmarkFile(text);
    const ctx: ImportContext = {
      nowIso: NOW,
      newId,
      barName: 'Bookmarks bar',
      barPaths: new Set(parsed.folders.filter((f) => f.isBookmarksBar).map((f) => importPathKey(f.path))),
      cache: new Map(),
    };
    const totals = { added: 0, skipped: 0, invalid: parsed.invalid };
    for (let i = 0; i < parsed.bookmarks.length; i += 500) {
      const c = await importChunk(db, parsed.bookmarks.slice(i, i + 500), ctx);
      totals.added += c.added;
      totals.skipped += c.skipped;
      totals.invalid += c.invalid;
    }
    return totals;
  }

  test('import keeps folders (the file’s bar → VidoraX’s bar); importing again skips everything', async () => {
    const { db } = await freshDb();
    assert.deepEqual(await runImport(db, chromeFile), { added: 3, skipped: 0, invalid: 1 });
    assert.deepEqual((await listFolderContents(db, BOOKMARKS_BAR_FOLDER_ID)).bookmarks.map((b) => b.title), ['Hacker News', 'لاہور & more']);
    assert.deepEqual(await runImport(db, chromeFile), { added: 0, skipped: 3, invalid: 1 });
    assert.equal((await listFolderContents(db, null)).folders.length, 2);
  });

  test('export → import round trip keeps folders, order, dates, tags and notes', async () => {
    const { db } = await freshDb();
    await runImport(db, chromeFile);
    const html = bookmarkFileHtml(await exportTree(db), new Date(NOW));
    assert.match(html, /PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar<\/H3>/);
    const again = await freshDb();
    assert.deepEqual(await runImport(again.db, html), { added: 3, skipped: 0, invalid: 0 });
    const other = (await listFolderContents(again.db, null)).folders.find((f) => f.name === 'Other bookmarks')!;
    const example = (await listFolderContents(again.db, other.id)).bookmarks[0];
    assert.deepEqual([example.title, example.tags, example.note, example.createdAt], ['Example', ['demo', 'test'], 'A note <b>here</b>', '2023-11-14T22:13:23.000Z']);
  });

  test('5,000 bookmarks (with icons) parse and import without freezing', async () => {
    const { db } = await freshDb();
    const lines = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<DL><p>'];
    for (let f = 0; f < 50; f++) {
      lines.push(`<DT><H3>Folder ${f}</H3>`, '<DL><p>');
      for (let i = 0; i < 100; i++) {
        const n = f * 100 + i;
        lines.push(`<DT><A HREF="https://site${n}.example.com/page" ADD_DATE="1700000000" ICON="data:image/png;base64,${'Q'.repeat(2000)}">Page ${n}</A>`);
      }
      lines.push('</DL><p>');
    }
    lines.push('</DL><p>');
    const text = lines.join('\n');
    assert.ok(text.length > 10_000_000);
    const parseStart = performance.now();
    const parsed = parseBookmarkFile(text);
    const parseMs = performance.now() - parseStart;
    assert.equal(parsed.bookmarks.length, 5000);
    const importStart = performance.now();
    const totals = await runImport(db, text);
    const importMs = performance.now() - importStart;
    assert.equal(totals.added, 5000);
    // Generous bounds for a slow CI machine; on this PC both are a fraction of these.
    assert.ok(parseMs < 3000, `parse ${parseMs.toFixed(0)} ms`);
    assert.ok(importMs < 15000, `import ${importMs.toFixed(0)} ms`);
    console.log(`[B9] 5,000 bookmarks / ${(text.length / 1e6).toFixed(1)} MB: parse ${parseMs.toFixed(0)} ms, import ${importMs.toFixed(0)} ms`);
  });
});
