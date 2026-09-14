import {
  BROWSER_PROGRESS_COMPLETE,
  BROWSER_PROGRESS_MIN_VISIBLE,
} from '@/browser/constants';

/**
 * Smooths raw WebView progress into a monotonic, flicker-free value.
 * Progress never decreases while loading; completion snaps to 1.
 */
export function normalizeLoadProgress(
  rawProgress: number,
  isLoading: boolean,
  previousProgress: number,
): number {
  const clamped = Math.max(0, Math.min(rawProgress, BROWSER_PROGRESS_COMPLETE));

  if (!isLoading && clamped >= BROWSER_PROGRESS_COMPLETE) {
    return BROWSER_PROGRESS_COMPLETE;
  }

  if (isLoading && clamped <= 0) {
    return Math.max(previousProgress, BROWSER_PROGRESS_MIN_VISIBLE);
  }

  if (isLoading) {
    return Math.max(previousProgress, clamped, BROWSER_PROGRESS_MIN_VISIBLE);
  }

  return clamped;
}
