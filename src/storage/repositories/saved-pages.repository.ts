import { toStorageError } from '@/storage/types';

// B20: the active browser profile's database (the app database for the default profile).
import { getBrowserDatabase as getDatabase } from '../sqlite/browser-database';
import { deleteSavedPage, insertSavedPage, listSavedPages, type SavedPage } from './saved-pages.queries';

export type { SavedPage } from './saved-pages.queries';

/** B17 #178 — saved pages, per browser profile; SQL in saved-pages.queries.ts. */
export class SavedPagesRepository {
  private async run<T>(what: string, task: (db: Awaited<ReturnType<typeof getDatabase>>) => Promise<T>): Promise<T> {
    try {
      return await task(await getDatabase());
    } catch (error) {
      throw toStorageError(error, `Failed to ${what}`, 'QUERY_FAILED');
    }
  }

  add(page: SavedPage): Promise<void> {
    return this.run('save a page', (db) => insertSavedPage(db, page));
  }

  list(): Promise<SavedPage[]> {
    return this.run('read saved pages', (db) => listSavedPages(db));
  }

  remove(id: string): Promise<boolean> {
    return this.run('delete a saved page', (db) => deleteSavedPage(db, id));
  }
}

export const savedPagesRepository = new SavedPagesRepository();
