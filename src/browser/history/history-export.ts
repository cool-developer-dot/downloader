import { csvCell } from '@/browser/data/history-csv';

/**
 * B10 #103 — History as a spreadsheet: one row per page with its title, address, last visit and visit count. Pure.
 * UTF-8 with a byte order mark and CRLF line ends (Excel then shows Urdu titles), cells escaped like B20's history CSV
 * (a cell a spreadsheet would read as a formula starts with an apostrophe).
 */

export type HistoryExportCsvRow = { title: string; url: string; lastVisitedAt: string; visitCount: number };

export type HistoryExportHeaders = { title: string; url: string; lastVisit: string; visitCount: string };

/** `2026-11-08 14:05` in the phone's local time, or the stored text when it isn't a time. */
export function formatExportTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

export function historyExportCsv(
  rows: readonly HistoryExportCsvRow[],
  headers: HistoryExportHeaders,
  formatTime: (iso: string) => string = formatExportTime,
): string {
  const lines = [[headers.title, headers.url, headers.lastVisit, headers.visitCount].map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(
      [row.title, row.url, formatTime(row.lastVisitedAt), String(Math.max(0, Math.trunc(row.visitCount)))]
        .map(csvCell)
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** `vidorax-history-2026-11-08.csv` (local date). */
export function historyExportFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `vidorax-history-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}
