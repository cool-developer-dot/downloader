/**
 * Heuristics for signed/expiring CDN media URLs.
 * Does not attempt to decode signatures — only detects likely expiry params.
 */

const EXPIRY_PARAM_NAMES = [
  'expires',
  'exp',
  'expire',
  'x-expires',
  'se',
  'st',
  'e',
] as const;

export type ExpiringUrlAssessment = {
  likelyExpiring: boolean;
  expiresAtMs: number | null;
  isExpired: boolean;
};

export function assessExpiringMediaUrl(url: string, nowMs = Date.now()): ExpiringUrlAssessment {
  try {
    const parsed = new URL(url);
    for (const name of EXPIRY_PARAM_NAMES) {
      const raw = parsed.searchParams.get(name);
      if (!raw) {
        continue;
      }
      const numeric = Number(raw);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        return { likelyExpiring: true, expiresAtMs: null, isExpired: false };
      }
      const expiresAtMs = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
      return {
        likelyExpiring: true,
        expiresAtMs,
        isExpired: nowMs >= expiresAtMs,
      };
    }
    if (/[?&](sig|signature|token|oh|oe)=/i.test(url)) {
      return { likelyExpiring: true, expiresAtMs: null, isExpired: false };
    }
  } catch {
    return { likelyExpiring: false, expiresAtMs: null, isExpired: false };
  }
  return { likelyExpiring: false, expiresAtMs: null, isExpired: false };
}

export function isLikelyExpiredMediaUrl(
  url: string,
  detectedAtMs: number,
  nowMs = Date.now(),
): boolean {
  const assessment = assessExpiringMediaUrl(url, nowMs);
  if (assessment.isExpired) {
    return true;
  }
  if (assessment.likelyExpiring && !assessment.expiresAtMs) {
    return nowMs - detectedAtMs > 120_000;
  }
  return false;
}
