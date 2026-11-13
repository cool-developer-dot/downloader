import { toStorageError } from '@/storage/types';

import type { UserScript } from '@/browser/devtools/devtools-core';

// B20: the active browser profile's database (the app database for the default profile).
import { getBrowserDatabase as getDatabase } from '../sqlite/browser-database';
import { deleteUserScript, listUserScripts, saveUserScript } from './user-scripts.queries';

/** B19 #199 — user scripts, per browser profile; SQL in user-scripts.queries.ts. */
export class UserScriptsRepository {
  private async run<T>(what: string, task: (db: Awaited<ReturnType<typeof getDatabase>>) => Promise<T>): Promise<T> {
    try {
      return await task(await getDatabase());
    } catch (error) {
      throw toStorageError(error, `Failed to ${what}`, 'QUERY_FAILED');
    }
  }

  list(): Promise<UserScript[]> {
    return this.run('read user scripts', (db) => listUserScripts(db));
  }

  save(script: UserScript): Promise<void> {
    return this.run('save a user script', (db) => saveUserScript(db, script, new Date().toISOString()));
  }

  remove(id: string): Promise<boolean> {
    return this.run('delete a user script', (db) => deleteUserScript(db, id));
  }
}

export const userScriptsRepository = new UserScriptsRepository();
