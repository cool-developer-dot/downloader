import { TABLE_NAMES } from '@/storage/constants';

/** B17 #178 — saved pages: SQL over a minimal database interface (tested on `node:sqlite`). */

export type SavedPagesDb = {
  runAsync(sql: string, ...params: (string | number | null)[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
};

export type SavedPage = { id: string; url: string; title: string; size: number; createdAt: string };

type Row = { id: string; url: string; title: string; size: number; created_at: string };

export async function insertSavedPage(db: SavedPagesDb, page: SavedPage): Promise<void> {
  await db.runAsync(
    `INSERT INTO ${TABLE_NAMES.savedPages} (id, url, title, size, created_at) VALUES (?, ?, ?, ?, ?)`,
    page.id,
    page.url,
    page.title.slice(0, 300),
    Math.max(0, Math.round(page.size)),
    page.createdAt,
  );
}

/** Newest first. */
export async function listSavedPages(db: SavedPagesDb): Promise<SavedPage[]> {
  const rows = await db.getAllAsync<Row>(`SELECT * FROM ${TABLE_NAMES.savedPages} ORDER BY created_at DESC`);
  return rows.map((r) => ({ id: r.id, url: r.url, title: r.title, size: Number(r.size), createdAt: r.created_at }));
}

export async function deleteSavedPage(db: SavedPagesDb, id: string): Promise<boolean> {
  return (await db.runAsync(`DELETE FROM ${TABLE_NAMES.savedPages} WHERE id = ?`, id)).changes > 0;
}
