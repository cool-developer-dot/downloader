import { TABLE_NAMES } from '@/storage/constants';

import { isHighlightColor, type HighlightColor } from '@/browser/highlights/highlights-core';

/** B23 — highlights and watched pages: SQL over a minimal database interface (tested on `node:sqlite`). */

export type AnnotateDb = {
  runAsync(sql: string, ...params: (string | number | null)[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null>;
};

export type Highlight = {
  id: string;
  pageUrl: string;
  pageTitle: string;
  text: string;
  prefix: string;
  suffix: string;
  color: HighlightColor;
  note: string;
  createdAt: string;
};

type HighlightRow = {
  id: string;
  page_url: string;
  page_title: string;
  exact: string;
  prefix: string;
  suffix: string;
  color: string;
  note: string;
  created_at: string;
};

const toHighlight = (r: HighlightRow): Highlight => ({
  id: r.id,
  pageUrl: r.page_url,
  pageTitle: r.page_title,
  text: r.exact,
  prefix: r.prefix,
  suffix: r.suffix,
  color: isHighlightColor(r.color) ? r.color : 'yellow',
  note: r.note,
  createdAt: r.created_at,
});

export async function insertHighlight(db: AnnotateDb, h: Highlight): Promise<void> {
  await db.runAsync(
    `INSERT INTO ${TABLE_NAMES.highlights} (id, page_url, page_title, exact, prefix, suffix, color, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    h.id,
    h.pageUrl,
    h.pageTitle.slice(0, 300),
    h.text.slice(0, 2000),
    h.prefix.slice(-32),
    h.suffix.slice(0, 32),
    h.color,
    h.note.slice(0, 2000),
    h.createdAt,
  );
}

export async function highlightsForPage(db: AnnotateDb, pageUrl: string): Promise<Highlight[]> {
  const rows = await db.getAllAsync<HighlightRow>(
    `SELECT * FROM ${TABLE_NAMES.highlights} WHERE page_url = ? ORDER BY created_at`,
    pageUrl,
  );
  return rows.map(toHighlight);
}

export async function allHighlights(db: AnnotateDb): Promise<Highlight[]> {
  const rows = await db.getAllAsync<HighlightRow>(`SELECT * FROM ${TABLE_NAMES.highlights} ORDER BY created_at DESC`);
  return rows.map(toHighlight);
}

export async function updateHighlight(db: AnnotateDb, id: string, color: HighlightColor, note: string): Promise<void> {
  await db.runAsync(`UPDATE ${TABLE_NAMES.highlights} SET color = ?, note = ? WHERE id = ?`, color, note.slice(0, 2000), id);
}

export async function deleteHighlight(db: AnnotateDb, id: string): Promise<boolean> {
  return (await db.runAsync(`DELETE FROM ${TABLE_NAMES.highlights} WHERE id = ?`, id)).changes > 0;
}

export type PageWatch = {
  id: string;
  url: string;
  title: string;
  hash: string;
  status: 'ok' | 'cannotWatch' | 'failed';
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
};

type WatchRow = {
  id: string;
  url: string;
  title: string;
  hash: string;
  status: string;
  last_checked_at: string | null;
  last_changed_at: string | null;
};

const toWatch = (r: WatchRow): PageWatch => ({
  id: r.id,
  url: r.url,
  title: r.title,
  hash: r.hash,
  status: r.status === 'cannotWatch' || r.status === 'failed' ? r.status : 'ok',
  lastCheckedAt: r.last_checked_at,
  lastChangedAt: r.last_changed_at,
});

export async function listWatches(db: AnnotateDb): Promise<PageWatch[]> {
  return (await db.getAllAsync<WatchRow>(`SELECT * FROM ${TABLE_NAMES.pageWatches} ORDER BY created_at`)).map(toWatch);
}

export async function countWatches(db: AnnotateDb): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${TABLE_NAMES.pageWatches}`))?.n ?? 0;
}

/** Adds a watch (an address already watched keeps its row); false when it wasn't added (already there). */
export async function addWatch(db: AnnotateDb, w: { id: string; url: string; title: string; hash: string }, nowIso: string): Promise<boolean> {
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO ${TABLE_NAMES.pageWatches} (id, url, title, hash, status, last_checked_at, created_at)
     VALUES (?, ?, ?, ?, 'ok', ?, ?)`,
    w.id,
    w.url,
    w.title.slice(0, 200),
    w.hash,
    nowIso,
    nowIso,
  );
  return result.changes > 0;
}

export async function recordCheck(
  db: AnnotateDb,
  id: string,
  result: { status: PageWatch['status']; hash?: string; title?: string; changed: boolean },
  nowIso: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE ${TABLE_NAMES.pageWatches}
       SET status = ?, hash = COALESCE(?, hash), title = CASE WHEN ? <> '' THEN ? ELSE title END,
           last_checked_at = ?, last_changed_at = CASE WHEN ? = 1 THEN ? ELSE last_changed_at END
     WHERE id = ?`,
    result.status,
    result.hash ?? null,
    result.title ?? '',
    (result.title ?? '').slice(0, 200),
    nowIso,
    result.changed ? 1 : 0,
    nowIso,
    id,
  );
}

export async function deleteWatch(db: AnnotateDb, id: string): Promise<boolean> {
  return (await db.runAsync(`DELETE FROM ${TABLE_NAMES.pageWatches} WHERE id = ?`, id)).changes > 0;
}
