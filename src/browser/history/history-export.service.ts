import { browsingDataRepository } from '@/storage/repositories';
import { translate } from '@/localization';
import { exportTextFile, type TextExportResult } from '@/utils/text-file-export';

import { historyExportCsv, historyExportFileName } from './history-export';

export type HistoryExportOutcome = TextExportResult | 'empty';

/**
 * B10 #103 — History as a CSV file in a folder the user picks (the system folder picker: no storage permission), or
 * the share sheet when no folder can be picked. Column titles are in the app's language.
 */
export async function exportHistoryToFile(now: Date = new Date()): Promise<HistoryExportOutcome> {
  const rows = await browsingDataRepository.listHistoryForExport();
  if (rows.length === 0) return 'empty';
  const content = historyExportCsv(rows, {
    title: translate('browserHistory.csvTitle'),
    url: translate('browserHistory.csvUrl'),
    lastVisit: translate('browserHistory.csvLastVisit'),
    visitCount: translate('browserHistory.csvVisitCount'),
  });
  return exportTextFile({
    fileName: historyExportFileName(now),
    mimeType: 'text/csv',
    content,
    shareTitle: translate('browserHistory.exportShareTitle'),
  });
}
