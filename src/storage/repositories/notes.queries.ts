import { TABLE_NAMES } from '@/storage/constants';

/**
 * B22 #252 — the notes SQL, over a minimal database interface (tests run it on `node:sqlite` with the app's schema;
 * `notes.repository.ts` runs it on the active browser profile's database).
 */

export type NotesDb = {
  runAsync(sql: string, ...params: (string | number | null)[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
};

export type Note = { id: string; text: string; pageUrl: string; pageTitle: string; createdAt: string; updatedAt: string };

export const MAX_NOTE_LENGTH = 10_000;

type Row = { id: string; text: string; page_url: string; page_title: string; created_at: string; updated_at: string };

const toNote = (r: Row): Note => ({
  id: r.id,
  text: r.text,
  pageUrl: r.page_url,
  pageTitle: r.page_title,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** `%`, `_` and `\` in a search are literal. */
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Newest first; with `query`, notes whose text, page title or address contain it (any case). */
export async function listNotes(db: NotesDb, query = '', limit = 500): Promise<Note[]> {
  const q = query.trim();
  const rows = q
    ? await db.getAllAsync<Row>(
        `SELECT * FROM ${TABLE_NAMES.notes}
         WHERE text LIKE ? ESCAPE '\\' OR page_title LIKE ? ESCAPE '\\' OR page_url LIKE ? ESCAPE '\\'
         ORDER BY updated_at DESC LIMIT ?`,
        likePattern(q),
        likePattern(q),
        likePattern(q),
        limit,
      )
    : await db.getAllAsync<Row>(`SELECT * FROM ${TABLE_NAMES.notes} ORDER BY updated_at DESC LIMIT ?`, limit);
  return rows.map(toNote);
}

export async function insertNote(
  db: NotesDb,
  note: { id: string; text: string; pageUrl: string; pageTitle: string },
  nowIso: string,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO ${TABLE_NAMES.notes} (id, text, page_url, page_title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    note.id,
    note.text.slice(0, MAX_NOTE_LENGTH),
    note.pageUrl.slice(0, 2048),
    note.pageTitle.slice(0, 300),
    nowIso,
    nowIso,
  );
}

export async function updateNoteText(db: NotesDb, id: string, text: string, nowIso: string): Promise<boolean> {
  const result = await db.runAsync(
    `UPDATE ${TABLE_NAMES.notes} SET text = ?, updated_at = ? WHERE id = ?`,
    text.slice(0, MAX_NOTE_LENGTH),
    nowIso,
    id,
  );
  return result.changes > 0;
}

export async function deleteNote(db: NotesDb, id: string): Promise<boolean> {
  return (await db.runAsync(`DELETE FROM ${TABLE_NAMES.notes} WHERE id = ?`, id)).changes > 0;
}
