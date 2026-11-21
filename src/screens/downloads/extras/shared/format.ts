/** Pure formatting shared by the download extra screens. */

/** A length as the design's clock: "00:12:44" (always hours, Latin digits in every language). */
export function formatClock(ms: number | null | undefined): string {
  const total = Math.max(0, Math.floor((typeof ms === 'number' && Number.isFinite(ms) ? ms : 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

/** The design's " · " separator between the parts of one line; empty parts are left out. */
export function joinDots(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' · ');
}

/** A 0–100 progress as a 0–1 fraction (anything unreadable is 0). */
export function fraction(percent: number | null | undefined): number {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) {
    return 0;
  }
  return Math.min(1, Math.max(0, percent / 100));
}
