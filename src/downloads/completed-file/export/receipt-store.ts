/**
 * Phase 7C — non-secret export receipt persistence via existing MMKV (not a new DB).
 */

import { mmkvGetObject, mmkvSetObject, mmkvRemove } from '@/storage/mmkv';

import {
  assertSafeExportReceiptFields,
  emptyExportReceipt,
  type ExportReceipt,
} from './receipt';

const KEY = 'vidorax.mmkv.completedFile.exportReceipts.v1';

type ReceiptMap = Record<string, ExportReceipt>;

function readAll(): ReceiptMap {
  try {
    const parsed = mmkvGetObject<ReceiptMap>(KEY);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function writeAll(map: ReceiptMap): void {
  const entries = Object.entries(map);
  if (entries.length > 400) {
    entries.sort((a, b) => {
      const at =
        Date.parse(a[1].exportedAt ?? a[1].pendingExportStartedAt ?? '') || 0;
      const bt =
        Date.parse(b[1].exportedAt ?? b[1].pendingExportStartedAt ?? '') || 0;
      return at - bt;
    });
    mmkvSetObject(KEY, Object.fromEntries(entries.slice(entries.length - 300)));
    return;
  }
  mmkvSetObject(KEY, map);
}

export function getExportReceipt(downloadId: string): ExportReceipt {
  const id = downloadId.trim();
  if (!id) {
    return emptyExportReceipt();
  }
  return { ...emptyExportReceipt(), ...(readAll()[id] ?? {}) };
}

export function setExportReceipt(
  downloadId: string,
  receipt: ExportReceipt,
): void {
  const id = downloadId.trim();
  if (!id) {
    return;
  }
  assertSafeExportReceiptFields(receipt);
  const all = readAll();
  all[id] = receipt;
  writeAll(all);
}

export function patchExportReceipt(
  downloadId: string,
  patch: Partial<ExportReceipt>,
): ExportReceipt {
  const next = { ...getExportReceipt(downloadId), ...patch };
  setExportReceipt(downloadId, next);
  return next;
}

export function clearExportReceipt(downloadId: string): void {
  const id = downloadId.trim();
  if (!id) {
    return;
  }
  const all = readAll();
  if (!(id in all)) {
    return;
  }
  delete all[id];
  if (Object.keys(all).length === 0) {
    mmkvRemove(KEY);
    return;
  }
  writeAll(all);
}

export function listPendingExportReceipts(): Array<{
  downloadId: string;
  receipt: ExportReceipt;
}> {
  return Object.entries(readAll())
    .filter(([, r]) => Boolean(r.pendingExportUri?.trim()))
    .map(([downloadId, receipt]) => ({ downloadId, receipt }));
}
