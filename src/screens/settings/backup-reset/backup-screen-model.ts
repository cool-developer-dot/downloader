/**
 * Files F11 · design 62 Backup: the Last backup card's words — "Today · 2 MB", "Nov 20, 2026 · 1.4 MB", or "Never" —
 * from the last backup VidoraX made on this phone. Pure.
 */

import type { TranslationKey } from '@/localization/types';

export type LastBackup = {
  /** When it was written (ISO). */
  at: string;
  /** Its size in bytes. */
  bytes: number;
};

export type Label = { key: TranslationKey; params?: Record<string, string | number> };

/** "512 B", "18 KB", "2 MB", "1.5 MB", "1.2 GB" (one decimal at most, none when whole). */
export function backupSize(bytes: number): string {
  const value = Math.max(0, Math.round(bytes));
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  const oneDecimal = (n: number) => String(Math.round(n * 10) / 10);
  if (value < 1024 * 1024 * 1024) return `${oneDecimal(value / (1024 * 1024))} MB`;
  return `${oneDecimal(value / (1024 * 1024 * 1024))} GB`;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** The Last backup card's second line. */
export function lastBackupLabel(last: LastBackup | null, now: Date, locale: string): Label {
  const at = last ? new Date(last.at) : null;
  if (!last || !at || Number.isNaN(at.getTime())) {
    return { key: 'fileManager.backupNever' };
  }
  const size = backupSize(last.bytes);
  if (sameLocalDay(at, now)) {
    return { key: 'fileManager.backupToday', params: { size } };
  }
  let date: string;
  try {
    date = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(at);
  } catch {
    date = at.toISOString().slice(0, 10);
  }
  return { key: 'fileManager.backupOnDate', params: { date, size } };
}

/** The bytes a text file takes in UTF-8 (what the backup file weighs). */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}
