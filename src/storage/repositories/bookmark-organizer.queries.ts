import { TABLE_NAMES } from '@/storage/constants';

/**
 * B9 — the SQL of bookmark folders, order, tags, notes, the bookmarks bar, import / export and the reading list, as
 * plain functions over a minimal database interface (tests run them on `node:sqlite` with the app's schema;
 * `bookmark-organizer.repository.ts` runs them on the active browser profile's database).
 *
 * The root folder is `folder_id` NULL. In a folder, sub-folders come first (by `position`), then bookmarks: those
 * with a position in order, but bookmarks added without one (the browser's star, B20's restore) first, newest first —
 * as the Bookmarks screen always showed them.
 */

type Param = string | number | null;

export type OrganizerDb = {
  runAsync(sql: string, ...params: Param[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, ...params: Param[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: Param[]): Promise<T | null>;
};

export type NewId = () => Promise<string>;

const B = TABLE_NAMES.bookmarks;
const F = TABLE_NAMES.bookmarkFolders;
const T = TABLE_NAMES.bookmarkTags;
const R = TABLE_NAMES.readingList;

/** The folder the bookmarks bar shows (B9 #81); created on first use. */
export const BOOKMARKS_BAR_FOLDER_ID = 'bookmarks-bar';
export const FOLDER_NAME_MAX = 80;
export const NOTE_MAX = 2000;
export const TAG_MAX = 40;
export const TAGS_PER_BOOKMARK_MAX = 20;
const MAX_DEPTH = 32;

export type BookmarkFolder = { id: string; parentId: string | null; name: string; position: number };

export type OrganizedBookmark = {
  id: string;
  url: string;
  title: string;
  hostname: string;
  faviconUrl: string | null;
  createdAt: string;
  updatedAt: string;
  folderId: string | null;
  position: number | null;
  note: string;
  tags: string[];
};

type FolderRow = { id: string; parent_id: string | null; name: string; position: number };
type BookmarkRow = {
  id: string;
  url: string;
  title: string;
  hostname: string;
  favicon_url: string | null;
  created_at: string;
  updated_at: string;
  folder_id: string | null;
  position: number | null;
  note: string | null;
};

export type OrganizerErrorCode = 'NOT_FOUND' | 'INVALID_NAME' | 'INVALID_URL' | 'DUPLICATE_URL' | 'CYCLE';

export class OrganizerError extends Error {
  readonly code: OrganizerErrorCode;

  constructor(code: OrganizerErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const mapFolder = (row: FolderRow): BookmarkFolder => ({
  id: row.id,
  parentId: row.parent_id,
  name: row.name,
  position: row.position,
});

function mapBookmark(row: BookmarkRow, tags: string[]): OrganizedBookmark {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    hostname: row.hostname,
    faviconUrl: row.favicon_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    folderId: row.folder_id,
    position: row.position,
    note: row.note ?? '',
    tags,
  };
}

const BOOKMARK_ORDER = `ORDER BY (position IS NULL) DESC, CASE WHEN position IS NULL THEN created_at END DESC, position ASC, created_at DESC`;

async function tagsFor(db: OrganizerDb, ids: readonly string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = await db.getAllAsync<{ bookmark_id: string; tag: string }>(
      `SELECT bookmark_id, tag FROM ${T} WHERE bookmark_id IN (${chunk.map(() => '?').join(',')}) ORDER BY tag`,
      ...chunk,
    );
    for (const row of rows) map.set(row.bookmark_id, [...(map.get(row.bookmark_id) ?? []), row.tag]);
  }
  return map;
}

async function withTags(db: OrganizerDb, rows: BookmarkRow[]): Promise<OrganizedBookmark[]> {
  const tags = await tagsFor(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((row) => mapBookmark(row, tags.get(row.id) ?? []));
}

export function normalizeFolderName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, FOLDER_NAME_MAX);
}

/** Tags as stored: trimmed, no commas, ≤ 40 characters, repeats (ignoring case) dropped, at most 20. */
export function normalizeTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.replace(/[,\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TAG_MAX);
    if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
    if (out.length >= TAGS_PER_BOOKMARK_MAX) break;
  }
  return out;
}

export async function getFolder(db: OrganizerDb, id: string): Promise<BookmarkFolder | null> {
  const row = await db.getFirstAsync<FolderRow>(`SELECT id, parent_id, name, position FROM ${F} WHERE id = ?`, id);
  return row ? mapFolder(row) : null;
}

/** #77 breadcrumbs: the folders from the root down to `id` (the root itself not included). */
export async function folderPath(db: OrganizerDb, id: string | null): Promise<BookmarkFolder[]> {
  const path: BookmarkFolder[] = [];
  let current = id;
  while (current && path.length < MAX_DEPTH) {
    const folder = await getFolder(db, current);
    if (!folder) break;
    path.unshift(folder);
    current = folder.parentId;
  }
  return path;
}

export async function listFolderContents(
  db: OrganizerDb,
  folderId: string | null,
): Promise<{ folders: BookmarkFolder[]; bookmarks: OrganizedBookmark[] }> {
  const folders = await db.getAllAsync<FolderRow>(
    `SELECT id, parent_id, name, position FROM ${F} WHERE parent_id IS ? ORDER BY position ASC, name ASC`,
    folderId,
  );
  const rows = await db.getAllAsync<BookmarkRow>(`SELECT * FROM ${B} WHERE folder_id IS ? ${BOOKMARK_ORDER}`, folderId);
  return { folders: folders.map(mapFolder), bookmarks: await withTags(db, rows) };
}

/** Every folder, for the "Move to folder" picker (indented by depth, A–Z within a parent). */
export async function listAllFolders(db: OrganizerDb): Promise<(BookmarkFolder & { depth: number })[]> {
  const rows = (await db.getAllAsync<FolderRow>(`SELECT id, parent_id, name, position FROM ${F}`)).map(mapFolder);
  const out: (BookmarkFolder & { depth: number })[] = [];
  const walk = (parentId: string | null, depth: number) => {
    if (depth > MAX_DEPTH) return;
    for (const folder of rows
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))) {
      out.push({ ...folder, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

async function nextFolderPosition(db: OrganizerDb, parentId: string | null): Promise<number> {
  const row = await db.getFirstAsync<{ next: number | null }>(
    `SELECT MAX(position) + 1 AS next FROM ${F} WHERE parent_id IS ?`,
    parentId,
  );
  return row?.next ?? 0;
}

async function nextBookmarkPosition(db: OrganizerDb, folderId: string | null): Promise<number> {
  const row = await db.getFirstAsync<{ next: number | null }>(
    `SELECT MAX(position) + 1 AS next FROM ${B} WHERE folder_id IS ?`,
    folderId,
  );
  return row?.next ?? 0;
}

/** #77: a new folder at the end of its parent (null = the root). */
export async function createFolder(
  db: OrganizerDb,
  input: { id: string; parentId: string | null; name: string; nowIso: string },
): Promise<BookmarkFolder> {
  const name = normalizeFolderName(input.name);
  if (!name) throw new OrganizerError('INVALID_NAME', 'A folder needs a name');
  if (input.parentId && !(await getFolder(db, input.parentId))) throw new OrganizerError('NOT_FOUND', 'No such folder');
  const position = await nextFolderPosition(db, input.parentId);
  await db.runAsync(
    `INSERT INTO ${F} (id, parent_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    input.id,
    input.parentId,
    name,
    position,
    input.nowIso,
    input.nowIso,
  );
  return { id: input.id, parentId: input.parentId, name, position };
}

export async function renameFolder(db: OrganizerDb, id: string, name: string, nowIso: string): Promise<void> {
  const clean = normalizeFolderName(name);
  if (!clean) throw new OrganizerError('INVALID_NAME', 'A folder needs a name');
  const result = await db.runAsync(`UPDATE ${F} SET name = ?, updated_at = ? WHERE id = ?`, clean, nowIso, id);
  if (result.changes === 0) throw new OrganizerError('NOT_FOUND', 'No such folder');
}

/** The folder and every folder inside it. */
async function folderAndDescendants(db: OrganizerDb, id: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ id: string }>(
    `WITH RECURSIVE tree(id, depth) AS (
       SELECT id, 0 FROM ${F} WHERE id = ?
       UNION ALL SELECT f.id, tree.depth + 1 FROM ${F} f JOIN tree ON f.parent_id = tree.id WHERE tree.depth < ${MAX_DEPTH}
     ) SELECT id FROM tree`,
    id,
  );
  return rows.map((r) => r.id);
}

/** #77 nest: moves a folder into another (null = the root); never into itself or one of its own sub-folders. */
export async function moveFolder(db: OrganizerDb, id: string, parentId: string | null, nowIso: string): Promise<void> {
  if (!(await getFolder(db, id))) throw new OrganizerError('NOT_FOUND', 'No such folder');
  if (parentId) {
    if ((await folderAndDescendants(db, id)).includes(parentId)) throw new OrganizerError('CYCLE', 'Not into itself');
    if (!(await getFolder(db, parentId))) throw new OrganizerError('NOT_FOUND', 'No such folder');
  }
  const position = await nextFolderPosition(db, parentId);
  await db.runAsync(`UPDATE ${F} SET parent_id = ?, position = ?, updated_at = ? WHERE id = ?`, parentId, position, nowIso, id);
}

/**
 * #77 delete: `moveUp` puts the folder's bookmarks and sub-folders into its parent (after what is there); `deleteAll`
 * deletes them with it (tags go with their bookmarks). Run in one transaction by the repository.
 */
export async function deleteFolder(db: OrganizerDb, id: string, mode: 'moveUp' | 'deleteAll'): Promise<{ bookmarks: number }> {
  const folder = await getFolder(db, id);
  if (!folder) throw new OrganizerError('NOT_FOUND', 'No such folder');
  if (mode === 'moveUp') {
    const base = await nextBookmarkPosition(db, folder.parentId);
    const moved = await db.getAllAsync<{ id: string }>(`SELECT id FROM ${B} WHERE folder_id = ? ${BOOKMARK_ORDER}`, id);
    for (let i = 0; i < moved.length; i++) {
      await db.runAsync(`UPDATE ${B} SET folder_id = ?, position = ? WHERE id = ?`, folder.parentId, base + i, moved[i].id);
    }
    const folderBase = await nextFolderPosition(db, folder.parentId);
    const children = await db.getAllAsync<{ id: string }>(`SELECT id FROM ${F} WHERE parent_id = ? ORDER BY position`, id);
    for (let i = 0; i < children.length; i++) {
      await db.runAsync(`UPDATE ${F} SET parent_id = ?, position = ? WHERE id = ?`, folder.parentId, folderBase + i, children[i].id);
    }
    await db.runAsync(`DELETE FROM ${F} WHERE id = ?`, id);
    return { bookmarks: 0 };
  }
  const ids = await folderAndDescendants(db, id);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const result = await db.runAsync(`DELETE FROM ${B} WHERE folder_id IN (${chunk.map(() => '?').join(',')})`, ...chunk);
    deleted += result.changes;
  }
  await db.runAsync(`DELETE FROM ${F} WHERE id = ?`, id);
  return { bookmarks: deleted };
}

export async function countInFolder(db: OrganizerDb, id: string): Promise<{ bookmarks: number; folders: number }> {
  const ids = await folderAndDescendants(db, id);
  let bookmarks = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${B} WHERE folder_id IN (${chunk.map(() => '?').join(',')})`,
      ...chunk,
    );
    bookmarks += Number(row?.n ?? 0);
  }
  return { bookmarks, folders: Math.max(0, ids.length - 1) };
}

/** #77: a bookmark into another folder (at its end). */
export async function moveBookmark(db: OrganizerDb, id: string, folderId: string | null, nowIso: string): Promise<void> {
  if (folderId && !(await getFolder(db, folderId))) throw new OrganizerError('NOT_FOUND', 'No such folder');
  const position = await nextBookmarkPosition(db, folderId);
  const result = await db.runAsync(
    `UPDATE ${B} SET folder_id = ?, position = ?, updated_at = ? WHERE id = ?`,
    folderId,
    position,
    nowIso,
    id,
  );
  if (result.changes === 0) throw new OrganizerError('NOT_FOUND', 'No such bookmark');
}

/** #80: the new order of a folder's bookmarks (or sub-folders); ids not in that folder are ignored. */
export async function setOrder(
  db: OrganizerDb,
  folderId: string | null,
  kind: 'bookmarks' | 'folders',
  orderedIds: readonly string[],
): Promise<void> {
  const table = kind === 'bookmarks' ? B : F;
  const column = kind === 'bookmarks' ? 'folder_id' : 'parent_id';
  for (let i = 0; i < orderedIds.length; i++) {
    await db.runAsync(`UPDATE ${table} SET position = ? WHERE id = ? AND ${column} IS ?`, i, orderedIds[i], folderId);
  }
}

export async function setTags(db: OrganizerDb, bookmarkId: string, tags: readonly string[]): Promise<string[]> {
  const clean = normalizeTags(tags);
  await db.runAsync(`DELETE FROM ${T} WHERE bookmark_id = ?`, bookmarkId);
  for (const tag of clean) {
    await db.runAsync(`INSERT OR IGNORE INTO ${T} (bookmark_id, tag) VALUES (?, ?)`, bookmarkId, tag);
  }
  return clean;
}

function isWebUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** #78 Edit: title, address (checked: http(s), not another bookmark's), folder, tags, note. */
export async function updateBookmarkDetails(
  db: OrganizerDb,
  id: string,
  input: { title: string; url: string; folderId: string | null; note: string; tags: readonly string[]; nowIso: string },
): Promise<void> {
  const current = await db.getFirstAsync<BookmarkRow>(`SELECT * FROM ${B} WHERE id = ?`, id);
  if (!current) throw new OrganizerError('NOT_FOUND', 'No such bookmark');
  const url = input.url.trim();
  if (!isWebUrl(url)) throw new OrganizerError('INVALID_URL', 'Not a web address');
  if (url !== current.url) {
    const other = await db.getFirstAsync<{ id: string }>(`SELECT id FROM ${B} WHERE url = ? AND id <> ?`, url, id);
    if (other) throw new OrganizerError('DUPLICATE_URL', 'Already bookmarked');
  }
  if (input.folderId && !(await getFolder(db, input.folderId))) throw new OrganizerError('NOT_FOUND', 'No such folder');
  const title = input.title.trim() || url;
  const note = input.note.trim().slice(0, NOTE_MAX);
  const folderChanged = (current.folder_id ?? null) !== input.folderId;
  const position = folderChanged ? await nextBookmarkPosition(db, input.folderId) : current.position;
  await db.runAsync(
    `UPDATE ${B} SET title = ?, url = ?, hostname = ?, folder_id = ?, position = ?, note = ?, updated_at = ? WHERE id = ?`,
    title.slice(0, 500),
    url,
    hostnameOf(url) || current.hostname,
    input.folderId,
    position,
    note,
    input.nowIso,
    id,
  );
  await setTags(db, id, input.tags);
}

export async function getOrganizedBookmark(db: OrganizerDb, id: string): Promise<OrganizedBookmark | null> {
  const row = await db.getFirstAsync<BookmarkRow>(`SELECT * FROM ${B} WHERE id = ?`, id);
  return row ? (await withTags(db, [row]))[0] : null;
}

export async function getOrganizedBookmarkByUrl(db: OrganizerDb, url: string): Promise<OrganizedBookmark | null> {
  const row = await db.getFirstAsync<BookmarkRow>(`SELECT * FROM ${B} WHERE url = ?`, url);
  return row ? (await withTags(db, [row]))[0] : null;
}

/** #92 tag chips: every tag with how many bookmarks have it, most used first. */
export async function listTags(db: OrganizerDb): Promise<{ tag: string; count: number }[]> {
  const rows = await db.getAllAsync<{ tag: string; n: number }>(
    `SELECT tag, COUNT(*) AS n FROM ${T} GROUP BY tag ORDER BY n DESC, tag ASC LIMIT 200`,
  );
  return rows.map((r) => ({ tag: r.tag, count: Number(r.n) }));
}

/**
 * #92 / #93 search across every folder: the text in title, address, host, note or a tag (A–Z case ignored, like the
 * rest of the app's searches); `tag` filters to one tag. At most 500.
 */
export async function searchBookmarks(db: OrganizerDb, query: string, tag: string | null): Promise<OrganizedBookmark[]> {
  const q = query.trim();
  const params: Param[] = [];
  const where: string[] = [];
  if (q) {
    const like = `%${q}%`;
    where.push(
      `(b.title LIKE ? OR b.url LIKE ? OR b.hostname LIKE ? OR b.note LIKE ? OR EXISTS (SELECT 1 FROM ${T} t WHERE t.bookmark_id = b.id AND t.tag LIKE ?))`,
    );
    params.push(like, like, like, like, like);
  }
  if (tag) {
    where.push(`EXISTS (SELECT 1 FROM ${T} t2 WHERE t2.bookmark_id = b.id AND t2.tag = ?)`);
    params.push(tag);
  }
  const rows = await db.getAllAsync<BookmarkRow>(
    `SELECT b.* FROM ${B} b ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY b.title COLLATE NOCASE ASC LIMIT 500`,
    ...params,
  );
  return withTags(db, rows);
}

/** #81: the bookmarks bar's folder, created the first time it is needed. */
export async function ensureBookmarksBarFolder(db: OrganizerDb, name: string, nowIso: string): Promise<BookmarkFolder> {
  const existing = await getFolder(db, BOOKMARKS_BAR_FOLDER_ID);
  if (existing) return existing;
  return createFolder(db, { id: BOOKMARKS_BAR_FOLDER_ID, parentId: null, name, nowIso });
}

/** A folder named `name` directly in `parentId`, created when missing (import, Bookmark all tabs). */
export async function ensureChildFolder(
  db: OrganizerDb,
  parentId: string | null,
  name: string,
  nowIso: string,
  newId: NewId,
): Promise<BookmarkFolder> {
  const clean = normalizeFolderName(name) || 'Folder';
  const row = await db.getFirstAsync<FolderRow>(
    `SELECT id, parent_id, name, position FROM ${F} WHERE parent_id IS ? AND name = ? LIMIT 1`,
    parentId,
    clean,
  );
  if (row) return mapFolder(row);
  return createFolder(db, { id: await newId(), parentId, name: clean, nowIso });
}

export type AddOutcome = 'added' | 'skipped' | 'invalid';

/**
 * Adds one bookmark into a folder (end of it). An address already bookmarked (anywhere: addresses are unique) is
 * skipped; one that isn't http(s) is invalid.
 */
export async function addBookmarkToFolder(
  db: OrganizerDb,
  input: {
    id: string;
    url: string;
    title: string;
    folderId: string | null;
    createdAtIso: string;
    nowIso: string;
    note?: string;
    tags?: readonly string[];
  },
): Promise<AddOutcome> {
  const url = input.url.trim();
  if (!isWebUrl(url)) return 'invalid';
  const position = await nextBookmarkPosition(db, input.folderId);
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO ${B} (id, url, title, hostname, favicon_url, created_at, updated_at, folder_id, position, note)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    input.id,
    url,
    (input.title.trim() || url).slice(0, 500),
    hostnameOf(url),
    input.createdAtIso,
    input.nowIso,
    input.folderId,
    position,
    (input.note ?? '').trim().slice(0, NOTE_MAX),
  );
  if (result.changes === 0) return 'skipped';
  if (input.tags?.length) await setTags(db, input.id, input.tags);
  return 'added';
}

export type ExportFolder = {
  name: string;
  isBookmarksBar: boolean;
  createdAt: string;
  folders: ExportFolder[];
  bookmarks: { url: string; title: string; createdAt: string; updatedAt: string; note: string; tags: string[] }[];
};

/** #85: the whole tree, in the user's order (root = a folder with an empty name). */
export async function exportTree(db: OrganizerDb): Promise<ExportFolder> {
  const folders = (await db.getAllAsync<FolderRow & { created_at: string }>(`SELECT id, parent_id, name, position, created_at FROM ${F}`)).map(
    (row) => ({ ...mapFolder(row), createdAt: row.created_at }),
  );
  const rows = await db.getAllAsync<BookmarkRow>(`SELECT * FROM ${B} ${BOOKMARK_ORDER}`);
  const tagged = await withTags(db, rows);
  const build = (id: string | null, name: string, createdAt: string, depth: number): ExportFolder => ({
    name,
    isBookmarksBar: id === BOOKMARKS_BAR_FOLDER_ID,
    createdAt,
    folders:
      depth > MAX_DEPTH
        ? []
        : folders
            .filter((f) => f.parentId === id)
            .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
            .map((f) => build(f.id, f.name, f.createdAt, depth + 1)),
    bookmarks: tagged
      .filter((b) => b.folderId === id)
      .map((b) => ({ url: b.url, title: b.title, createdAt: b.createdAt, updatedAt: b.updatedAt, note: b.note, tags: b.tags })),
  });
  return build(null, '', '', 0);
}

// --- #89 Reading list ------------------------------------------------------------------------------------------

export type ReadingItem = {
  id: string;
  url: string;
  title: string;
  hostname: string;
  createdAt: string;
  readAt: string | null;
  /** B17's offline copy of the page, when it saves one (the named hook: `setReadingOfflineCopy`). */
  offlineUri: string | null;
};

type ReadingRow = { id: string; url: string; title: string; hostname: string; created_at: string; read_at: string | null; offline_uri: string | null };

const mapReading = (row: ReadingRow): ReadingItem => ({
  id: row.id,
  url: row.url,
  title: row.title,
  hostname: row.hostname,
  createdAt: row.created_at,
  readAt: row.read_at,
  offlineUri: row.offline_uri,
});

/** Adds a page (unread). A page already on the list becomes unread again and moves to the top. */
export async function addToReadingList(
  db: OrganizerDb,
  input: { id: string; url: string; title: string; nowIso: string },
): Promise<'added' | 'exists' | 'invalid'> {
  const url = input.url.trim();
  if (!isWebUrl(url)) return 'invalid';
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO ${R} (id, url, title, hostname, created_at, read_at, offline_uri) VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
    input.id,
    url,
    (input.title.trim() || url).slice(0, 500),
    hostnameOf(url),
    input.nowIso,
  );
  if (result.changes > 0) return 'added';
  await db.runAsync(`UPDATE ${R} SET read_at = NULL, created_at = ? WHERE url = ?`, input.nowIso, url);
  return 'exists';
}

export async function listReadingList(db: OrganizerDb, read: boolean): Promise<ReadingItem[]> {
  const rows = await db.getAllAsync<ReadingRow>(
    read
      ? `SELECT * FROM ${R} WHERE read_at IS NOT NULL ORDER BY read_at DESC`
      : `SELECT * FROM ${R} WHERE read_at IS NULL ORDER BY created_at DESC`,
  );
  return rows.map(mapReading);
}

export async function setReadingRead(db: OrganizerDb, id: string, read: boolean, nowIso: string): Promise<void> {
  await db.runAsync(`UPDATE ${R} SET read_at = ? WHERE id = ?`, read ? nowIso : null, id);
}

export async function removeFromReadingList(db: OrganizerDb, id: string): Promise<void> {
  await db.runAsync(`DELETE FROM ${R} WHERE id = ?`, id);
}

/** The named hook for B17: an offline copy of a reading-list page (a file URI in the app's storage; null removes it). */
export async function setReadingOfflineCopy(db: OrganizerDb, id: string, offlineUri: string | null): Promise<void> {
  await db.runAsync(`UPDATE ${R} SET offline_uri = ? WHERE id = ?`, offlineUri, id);
}

export async function isOnReadingList(db: OrganizerDb, url: string): Promise<boolean> {
  return (await db.getFirstAsync<{ id: string }>(`SELECT id FROM ${R} WHERE url = ? LIMIT 1`, url.trim())) != null;
}

// --- #84 Import ------------------------------------------------------------------------------------------------

export type ImportItem = {
  path: string[];
  url: string;
  title: string;
  addedAt: string | null;
  tags: string[];
  note: string;
};

export type ImportContext = {
  nowIso: string;
  newId: NewId;
  /** Folder paths (joined with a line break) that were the file's bookmarks bar: they become VidoraX's bar. */
  barPaths: ReadonlySet<string>;
  barName: string;
  /** Path → folder id, filled as folders are found or made. */
  cache: Map<string, string | null>;
};

export const importPathKey = (path: readonly string[]): string => path.join('\n');

/** The folder for a path from the file: same names at the same level are reused, so importing again adds nothing. */
export async function resolveImportFolder(db: OrganizerDb, path: readonly string[], ctx: ImportContext): Promise<string | null> {
  if (path.length === 0) return null;
  const key = importPathKey(path);
  if (ctx.cache.has(key)) return ctx.cache.get(key)!;
  let id: string | null;
  if (ctx.barPaths.has(key)) {
    id = (await ensureBookmarksBarFolder(db, ctx.barName, ctx.nowIso)).id;
  } else {
    const parent = await resolveImportFolder(db, path.slice(0, -1), ctx);
    id = (await ensureChildFolder(db, parent, path[path.length - 1], ctx.nowIso, ctx.newId)).id;
  }
  ctx.cache.set(key, id);
  return id;
}

/** One chunk of an import (the repository runs each chunk in its own transaction). */
export async function importChunk(
  db: OrganizerDb,
  items: readonly ImportItem[],
  ctx: ImportContext,
): Promise<{ added: number; skipped: number; invalid: number }> {
  const counts = { added: 0, skipped: 0, invalid: 0 };
  for (const item of items) {
    const folderId = await resolveImportFolder(db, item.path, ctx);
    const outcome = await addBookmarkToFolder(db, {
      id: await ctx.newId(),
      url: item.url,
      title: item.title,
      folderId,
      createdAtIso: item.addedAt ?? ctx.nowIso,
      nowIso: ctx.nowIso,
      note: item.note,
      tags: item.tags,
    });
    counts[outcome] += 1;
  }
  return counts;
}
