import { toStorageError } from '@/storage/types';

import type { HighlightColor } from '@/browser/highlights/highlights-core';

// B20: the active browser profile's database (the app database for the default profile).
import { getBrowserDatabase as getDatabase } from '../sqlite/browser-database';
import {
  addWatch,
  allHighlights,
  countWatches,
  deleteHighlight,
  deleteWatch,
  highlightsForPage,
  insertHighlight,
  listWatches,
  recordCheck,
  updateHighlight,
  type Highlight,
  type PageWatch,
} from './annotate.queries';

export type { Highlight, PageWatch } from './annotate.queries';

/** B23 — highlights and watched pages, per browser profile; SQL in annotate.queries.ts. */
export class AnnotateRepository {
  private async run<T>(what: string, task: (db: Awaited<ReturnType<typeof getDatabase>>) => Promise<T>): Promise<T> {
    try {
      return await task(await getDatabase());
    } catch (error) {
      throw toStorageError(error, `Failed to ${what}`, 'QUERY_FAILED');
    }
  }

  addHighlight(h: Highlight): Promise<void> {
    return this.run('save a highlight', (db) => insertHighlight(db, h));
  }

  highlightsForPage(pageUrl: string): Promise<Highlight[]> {
    return this.run('read highlights', (db) => highlightsForPage(db, pageUrl));
  }

  allHighlights(): Promise<Highlight[]> {
    return this.run('read highlights', (db) => allHighlights(db));
  }

  updateHighlight(id: string, color: HighlightColor, note: string): Promise<void> {
    return this.run('update a highlight', (db) => updateHighlight(db, id, color, note));
  }

  deleteHighlight(id: string): Promise<boolean> {
    return this.run('delete a highlight', (db) => deleteHighlight(db, id));
  }

  listWatches(): Promise<PageWatch[]> {
    return this.run('read watched pages', (db) => listWatches(db));
  }

  countWatches(): Promise<number> {
    return this.run('count watched pages', (db) => countWatches(db));
  }

  addWatch(w: { id: string; url: string; title: string; hash: string }): Promise<boolean> {
    return this.run('watch a page', (db) => addWatch(db, w, new Date().toISOString()));
  }

  recordCheck(id: string, result: { status: PageWatch['status']; hash?: string; title?: string; changed: boolean }): Promise<void> {
    return this.run('record a page check', (db) => recordCheck(db, id, result, new Date().toISOString()));
  }

  deleteWatch(id: string): Promise<boolean> {
    return this.run('stop watching a page', (db) => deleteWatch(db, id));
  }
}

export const annotateRepository = new AnnotateRepository();
