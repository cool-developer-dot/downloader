import { toStorageError } from '@/storage/types';
import { createId, nowIso } from '@/storage/utils';

// B20: the active browser profile's database (the app database for the default profile).
import {
  getBrowserDatabase as getDatabase,
  withBrowserDatabaseTransaction as withDatabaseTransaction,
} from '../sqlite/browser-database';
import * as q from './bookmark-organizer.queries';

export type {
  BookmarkFolder,
  ExportFolder,
  ImportItem,
  OrganizedBookmark,
  ReadingItem,
} from './bookmark-organizer.queries';
export { BOOKMARKS_BAR_FOLDER_ID, OrganizerError } from './bookmark-organizer.queries';

/** Rows per import transaction: 5,000 bookmarks are 10 short transactions, so the UI stays responsive between them. */
export const IMPORT_CHUNK = 500;

async function run<T>(label: string, task: (db: q.OrganizerDb) => Promise<T>): Promise<T> {
  try {
    return await task((await getDatabase()) as unknown as q.OrganizerDb);
  } catch (error) {
    if (error instanceof q.OrganizerError) throw error;
    throw toStorageError(error, label, 'QUERY_FAILED');
  }
}

async function inTransaction<T>(label: string, task: (db: q.OrganizerDb) => Promise<T>): Promise<T> {
  try {
    return await withDatabaseTransaction((db) => task(db as unknown as q.OrganizerDb));
  } catch (error) {
    const inner = (error as { cause?: unknown })?.cause;
    if (error instanceof q.OrganizerError) throw error;
    if (inner instanceof q.OrganizerError) throw inner;
    throw toStorageError(error, label, 'TRANSACTION_FAILED');
  }
}

/**
 * B9 — bookmark folders, order, tags, notes, the bookmarks bar, import / export and the reading list, for the browser
 * profile in use. SQL in `bookmark-organizer.queries.ts`. The existing `BookmarkRepository` (star, list, delete) is
 * unchanged and works on the same table.
 */
export const bookmarkOrganizerRepository = {
  listFolder: (folderId: string | null) => run('Failed to list the folder', (db) => q.listFolderContents(db, folderId)),
  folderPath: (folderId: string | null) => run('Failed to read the folder path', (db) => q.folderPath(db, folderId)),
  listAllFolders: () => run('Failed to list folders', (db) => q.listAllFolders(db)),
  countInFolder: (id: string) => run('Failed to count the folder', (db) => q.countInFolder(db, id)),

  async createFolder(parentId: string | null, name: string) {
    const id = await createId();
    return run('Failed to create the folder', (db) => q.createFolder(db, { id, parentId, name, nowIso: nowIso() }));
  },
  renameFolder: (id: string, name: string) => run('Failed to rename the folder', (db) => q.renameFolder(db, id, name, nowIso())),
  moveFolder: (id: string, parentId: string | null) =>
    inTransaction('Failed to move the folder', (db) => q.moveFolder(db, id, parentId, nowIso())),
  deleteFolder: (id: string, mode: 'moveUp' | 'deleteAll') =>
    inTransaction('Failed to delete the folder', (db) => q.deleteFolder(db, id, mode)),

  moveBookmark: (id: string, folderId: string | null) =>
    run('Failed to move the bookmark', (db) => q.moveBookmark(db, id, folderId, nowIso())),
  setOrder: (folderId: string | null, kind: 'bookmarks' | 'folders', ids: readonly string[]) =>
    inTransaction('Failed to save the order', (db) => q.setOrder(db, folderId, kind, ids)),
  updateDetails: (
    id: string,
    input: { title: string; url: string; folderId: string | null; note: string; tags: readonly string[] },
  ) => inTransaction('Failed to save the bookmark', (db) => q.updateBookmarkDetails(db, id, { ...input, nowIso: nowIso() })),
  get: (id: string) => run('Failed to read the bookmark', (db) => q.getOrganizedBookmark(db, id)),
  getByUrl: (url: string) => run('Failed to read the bookmark', (db) => q.getOrganizedBookmarkByUrl(db, url)),
  listTags: () => run('Failed to list tags', (db) => q.listTags(db)),
  search: (query: string, tag: string | null) => run('Failed to search bookmarks', (db) => q.searchBookmarks(db, query, tag)),

  ensureBookmarksBar: (name: string) => run('Failed to make the bookmarks bar', (db) => q.ensureBookmarksBarFolder(db, name, nowIso())),
  listBookmarksBar: () => run('Failed to read the bookmarks bar', (db) => q.listFolderContents(db, q.BOOKMARKS_BAR_FOLDER_ID)),

  /** #83: a new folder (named `folderName` in the root) holding these pages; addresses already bookmarked are skipped. */
  async bookmarkAll(folderName: string, pages: readonly { url: string; title: string }[]) {
    const ids = await Promise.all(pages.map(() => createId()));
    const folderId = await createId();
    return inTransaction('Failed to bookmark the tabs', async (db) => {
      const now = nowIso();
      const folder = await q.createFolder(db, { id: folderId, parentId: null, name: folderName, nowIso: now });
      const counts = { added: 0, skipped: 0, invalid: 0 };
      for (let i = 0; i < pages.length; i++) {
        const outcome = await q.addBookmarkToFolder(db, {
          id: ids[i],
          url: pages[i].url,
          title: pages[i].title,
          folderId: folder.id,
          createdAtIso: now,
          nowIso: now,
        });
        counts[outcome] += 1;
      }
      return { folder, ...counts };
    });
  },

  /** #84: imports parsed bookmarks in transactions of IMPORT_CHUNK; `onProgress` after each. */
  async importItems(
    items: readonly q.ImportItem[],
    barPaths: ReadonlySet<string>,
    barName: string,
    onProgress?: (done: number, total: number) => void,
  ) {
    const ctx: q.ImportContext = { nowIso: nowIso(), newId: createId, barPaths, barName, cache: new Map() };
    const totals = { added: 0, skipped: 0, invalid: 0 };
    for (let i = 0; i < items.length; i += IMPORT_CHUNK) {
      const chunk = items.slice(i, i + IMPORT_CHUNK);
      const counts = await inTransaction('Failed to import bookmarks', (db) => q.importChunk(db, chunk, ctx));
      totals.added += counts.added;
      totals.skipped += counts.skipped;
      totals.invalid += counts.invalid;
      onProgress?.(Math.min(items.length, i + IMPORT_CHUNK), items.length);
      // Let the UI draw between chunks.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return totals;
  },
  exportTree: () => run('Failed to read bookmarks for export', (db) => q.exportTree(db)),
  listAllLinks: () => run('Failed to list bookmarks', (db) => q.listAllBookmarkLinks(db)),
  setUrl: (id: string, url: string) => run('Failed to change the address', (db) => q.setBookmarkUrl(db, id, url, nowIso())),

  async addToReadingList(url: string, title: string) {
    const id = await createId();
    return run('Failed to add to the reading list', (db) => q.addToReadingList(db, { id, url, title, nowIso: nowIso() }));
  },
  listReading: (read: boolean) => run('Failed to read the reading list', (db) => q.listReadingList(db, read)),
  setRead: (id: string, read: boolean) => run('Failed to update the reading list', (db) => q.setReadingRead(db, id, read, nowIso())),
  removeReading: (id: string) => run('Failed to update the reading list', (db) => q.removeFromReadingList(db, id)),
  /** The named hook for B17's offline copies of reading-list pages. */
  setReadingOfflineCopy: (id: string, offlineUri: string | null) =>
    run('Failed to update the reading list', (db) => q.setReadingOfflineCopy(db, id, offlineUri)),
};
