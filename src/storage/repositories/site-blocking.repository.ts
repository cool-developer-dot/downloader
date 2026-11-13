import { toStorageError } from '@/storage/types';

import type { SiteLimitsState } from '@/browser/blocking/site-limits';

// B20: the active browser profile's database (the app database for the default profile).
import { getBrowserDatabase as getDatabase } from '../sqlite/browser-database';
import {
  addListSite,
  addTimeUsed,
  endFocus,
  loadSiteLimits,
  pruneTimeUsedBefore,
  removeListSite,
  removeTimeLimit,
  setTimeLimit,
  startFocus,
  type SiteListName,
} from './site-blocking.queries';

export type { SiteListName } from './site-blocking.queries';

/** B14 — the site blocker, time limits and focus mode, per browser profile; SQL in site-blocking.queries.ts. */
export class SiteBlockingRepository {
  private async run<T>(what: string, task: (db: Awaited<ReturnType<typeof getDatabase>>) => Promise<T>): Promise<T> {
    try {
      return await task(await getDatabase());
    } catch (error) {
      throw toStorageError(error, `Failed to ${what}`, 'QUERY_FAILED');
    }
  }

  load(day: string): Promise<SiteLimitsState> {
    return this.run('read site blocking', (db) => loadSiteLimits(db, day));
  }

  addSite(list: SiteListName, site: string): Promise<void> {
    return this.run('add a blocked site', (db) => addListSite(db, list, site, new Date().toISOString()));
  }

  removeSite(list: SiteListName, site: string): Promise<void> {
    return this.run('remove a blocked site', (db) => removeListSite(db, list, site));
  }

  setTimeLimit(site: string, minutes: number): Promise<void> {
    return this.run('save a time limit', (db) => setTimeLimit(db, site, minutes, new Date().toISOString()));
  }

  removeTimeLimit(site: string): Promise<void> {
    return this.run('remove a time limit', (db) => removeTimeLimit(db, site));
  }

  addTimeUsed(day: string, site: string, seconds: number): Promise<void> {
    return this.run('save time used', (db) => addTimeUsed(db, day, site, seconds));
  }

  pruneTimeUsedBefore(day: string): Promise<void> {
    return this.run('tidy time used', (db) => pruneTimeUsedBefore(db, day));
  }

  startFocus(startedAt: number, minutes: number): Promise<number> {
    return this.run('start focus mode', (db) => startFocus(db, startedAt, minutes));
  }

  endFocus(): Promise<void> {
    return this.run('end focus mode', (db) => endFocus(db));
  }
}

export const siteBlockingRepository = new SiteBlockingRepository();
