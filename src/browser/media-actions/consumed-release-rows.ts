import { needsFreshSource } from '@/downloads/v2/actions';

export type DownloadRowLike = { status?: string | null; errorCode?: string | null } | undefined;

/** Ids whose row has just become FAILED for want of a fresh link (each failure is reported once). */
export function newlyFailedForFreshSource(
  next: Readonly<Record<string, DownloadRowLike>>,
  previous: Readonly<Record<string, DownloadRowLike>>,
): string[] {
  const ids: string[] = [];
  for (const [id, row] of Object.entries(next)) {
    if (row === previous[id] || row?.status !== 'FAILED' || !needsFreshSource(row.errorCode)) {
      continue;
    }
    if (previous[id]?.status === 'FAILED') {
      continue;
    }
    ids.push(id);
  }
  return ids;
}
