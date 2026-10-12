/**
 * Download speed limits (F2): the choices offered for the global limit (Download Settings) and a download's own limit
 * (Download details), in bytes per second. 0 means no limit. Pure — Node tests run it directly.
 */

const KIB = 1024;
const MIB = 1024 * 1024;

export const SPEED_LIMIT_CHOICES = [0, 256 * KIB, 512 * KIB, 1 * MIB, 2 * MIB, 5 * MIB] as const;

export type SpeedLimitChoice = (typeof SPEED_LIMIT_CHOICES)[number];

export const DEFAULT_SPEED_LIMIT: SpeedLimitChoice = 0;

/** A stored or received value → one of the choices (anything else is no limit). */
export function normalizeSpeedLimit(value: unknown): SpeedLimitChoice {
  const parsed = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return (SPEED_LIMIT_CHOICES as readonly number[]).includes(parsed) ? (parsed as SpeedLimitChoice) : 0;
}

/** The engine's form: null for no limit. */
export function speedLimitForEngine(value: unknown): number | null {
  const choice = normalizeSpeedLimit(value);
  return choice === 0 ? null : choice;
}

export type SpeedLimitLabel = { kind: 'off' } | { kind: 'kb'; value: number } | { kind: 'mb'; value: number };

/** What to show for a choice; the screen turns it into "Off", "512 KB/s", "2 MB/s" in the app's language. */
export function speedLimitLabel(value: unknown): SpeedLimitLabel {
  const choice = normalizeSpeedLimit(value);
  if (choice === 0) {
    return { kind: 'off' };
  }
  return choice >= MIB ? { kind: 'mb', value: choice / MIB } : { kind: 'kb', value: choice / KIB };
}

/** Short segment label (the full one is the accessibility label): "Off", "256K", "1M". */
export function speedLimitShortLabel(value: unknown, offLabel: string): string {
  const label = speedLimitLabel(value);
  if (label.kind === 'off') {
    return offLabel;
  }
  return label.kind === 'mb' ? `${label.value}M` : `${label.value}K`;
}
