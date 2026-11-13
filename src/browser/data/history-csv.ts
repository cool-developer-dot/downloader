/**
 * B20 #210 Export data — browsing history as CSV for a spreadsheet. Pure. UTF-8 with a byte order mark and CRLF line
 * ends, so Excel shows Urdu titles; a cell that a spreadsheet would read as a formula (=, +, -, @, tab) starts with
 * an apostrophe instead. B10 (#103) can reuse it.
 */

export type HistoryCsvRow = { title: string; url: string; visitedAt: string };

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function historyCsv(rows: readonly HistoryCsvRow[], headers: { title: string; url: string; visitedAt: string }): string {
  const lines = [[headers.title, headers.url, headers.visitedAt].map(csvCell).join(',')];
  for (const row of rows) {
    lines.push([row.title, row.url, row.visitedAt].map(csvCell).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
