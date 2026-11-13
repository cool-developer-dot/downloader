import { toStorageError } from '@/storage/types';

// B20: the active browser profile's database (the app database for the default profile).
import {
  getBrowserDatabase as getDatabase,
  withBrowserDatabaseTransaction as withDatabaseTransaction,
} from '../sqlite/browser-database';
import {
  deleteBrowsingDataSince,
  listHistoryForExport,
  type BrowsingDataCleared,
  type HistoryExportRow,
} from './browsing-data.queries';

export type { BrowsingDataCleared, HistoryExportRow } from './browsing-data.queries';

/** B10 — clear browsing data by time range (#98, #99) and the history export (#103); SQL in browsing-data.queries.ts. */
export class BrowsingDataRepository {
  /** In one transaction, on the active browser profile's database. */
  async deleteSince(sinceIso: string | null): Promise<BrowsingDataCleared> {
    try {
      return await withDatabaseTransaction((db) => deleteBrowsingDataSince(db, sinceIso));
    } catch (error) {
      throw toStorageError(error, 'Failed to clear browsing data', 'QUERY_FAILED');
    }
  }

  async listHistoryForExport(): Promise<HistoryExportRow[]> {
    try {
      return await listHistoryForExport(await getDatabase());
    } catch (error) {
      throw toStorageError(error, 'Failed to read history for export', 'QUERY_FAILED');
    }
  }
}

export const browsingDataRepository = new BrowsingDataRepository();
