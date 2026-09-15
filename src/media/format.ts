/**
 * Display formatting for sizes, transfer rates, durations and resolutions.
 * Pure and free of React Native so it runs under `node --test`.
 */

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Decimal units (1 KB = 1000 B), matching Android's own storage screens. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1) {
    return '0 B';
  }
  let value = bytes;
  let unit = 0;
  // 999.5 rather than 1000 so values that would round up to "1000" move to the next unit.
  while (value >= 999.5 && unit < SIZE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const decimals = unit === 0 || value >= 99.95 ? 0 : 1;
  return `${trimTrailingZero(value.toFixed(decimals))} ${SIZE_UNITS[unit]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** `m:ss`, or `h:mm:ss` from one hour. */
export function formatClock(totalSeconds: number): string {
  const whole = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.round(totalSeconds) : 0;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = String(whole % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

export function formatDurationMs(durationMs: number | null): string | null {
  return durationMs != null && Number.isFinite(durationMs) && durationMs >= 1000
    ? formatClock(durationMs / 1000)
    : null;
}

export function formatEta(etaSeconds: number | null): string | null {
  return etaSeconds != null && Number.isFinite(etaSeconds) && etaSeconds >= 1 ? formatClock(etaSeconds) : null;
}

export function formatPercent(fraction: number): string {
  return `${Math.floor(clampFraction(fraction) * 100)}%`;
}

/** Progress 0..1: the fraction native reported, else bytes over total, else null (unknown). */
export function transferFraction(
  bytesDone: number,
  totalBytes: number | null,
  reportedFraction: number | null = null,
): number | null {
  if (reportedFraction != null && Number.isFinite(reportedFraction)) {
    return clampFraction(reportedFraction);
  }
  if (totalBytes != null && totalBytes > 0) {
    return clampFraction(bytesDone / totalBytes);
  }
  return null;
}

const RESOLUTION_TIERS = [
  { minHeight: 4000, label: '8K' },
  { minHeight: 2000, label: '4K' },
  { minHeight: 1300, label: '1440p' },
  { minHeight: 1000, label: '1080p' },
  { minHeight: 700, label: '720p' },
  { minHeight: 460, label: '480p' },
  { minHeight: 340, label: '360p' },
  { minHeight: 220, label: '240p' },
] as const;

/**
 * Quality label such as "1080p" or "4K". Uses the short side, or the 16:9-equivalent height of wide
 * frames, so portrait 1080x1920 and cinema 1920x800 both read "1080p".
 */
export function resolutionLabel(width: number | null, height: number | null): string | null {
  if (height == null || !(height > 0)) {
    return null;
  }
  const effectiveHeight =
    width != null && width > 0 ? Math.max(Math.min(width, height), (Math.max(width, height) * 9) / 16) : height;
  return RESOLUTION_TIERS.find((tier) => effectiveHeight >= tier.minHeight)?.label ?? null;
}

function clampFraction(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function trimTrailingZero(text: string): string {
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}
