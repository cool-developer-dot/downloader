/** Leftover download files (F15) — the pure part: which v1 downloads keep their temporary parts. */

/** v1 downloads that may still use their temporary parts: running, waiting, paused, or failed (Retry resumes). */
const ACTIVE_LEGACY_STATUSES = new Set(['QUEUED', 'DOWNLOADING', 'PAUSED', 'FAILED']);

/** The v1 download ids whose temporary parts must stay. */
export function activeLegacyIds(itemsById: Record<string, { id: string; status: string }>): string[] {
  return Object.values(itemsById)
    .filter((item) => ACTIVE_LEGACY_STATUSES.has(item.status))
    .map((item) => item.id)
    .sort();
}
