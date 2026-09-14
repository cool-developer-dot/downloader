/**
 * Pure aggregate progress for FGS notification.
 * Weighted by known totals — never averages bare percentages.
 */

export type AggregateProgressInput = {
  bytesDownloaded: number;
  totalBytes: number | null;
  progressPercent: number | null;
};

export type AggregateProgressResult = {
  progressPercent: number | null;
  bytesDownloaded: number | null;
  totalBytes: number | null;
  indeterminate: boolean;
};

/**
 * Compute aggregate progress across active jobs.
 * - All known totals → weighted percent
 * - Any unknown total → indeterminate (no fake average)
 * - Single job → pass through
 */
export function computeAggregateProgress(
  jobs: readonly AggregateProgressInput[],
): AggregateProgressResult {
  if (jobs.length === 0) {
    return {
      progressPercent: null,
      bytesDownloaded: null,
      totalBytes: null,
      indeterminate: true,
    };
  }

  if (jobs.length === 1) {
    const job = jobs[0]!;
    const total =
      job.totalBytes != null && job.totalBytes > 0 ? job.totalBytes : null;
    const bytes = Math.max(0, job.bytesDownloaded);
    if (total != null) {
      const pct = Math.max(
        0,
        Math.min(100, Math.floor((bytes / total) * 100)),
      );
      return {
        progressPercent: pct,
        bytesDownloaded: bytes,
        totalBytes: total,
        indeterminate: false,
      };
    }
    if (
      typeof job.progressPercent === 'number' &&
      Number.isFinite(job.progressPercent) &&
      job.progressPercent > 0
    ) {
      return {
        progressPercent: Math.max(0, Math.min(100, Math.floor(job.progressPercent))),
        bytesDownloaded: bytes > 0 ? bytes : null,
        totalBytes: null,
        indeterminate: false,
      };
    }
    return {
      progressPercent: null,
      bytesDownloaded: bytes > 0 ? bytes : null,
      totalBytes: null,
      indeterminate: true,
    };
  }

  let knownBytes = 0;
  let knownTotal = 0;
  let allKnown = true;

  for (const job of jobs) {
    const total =
      job.totalBytes != null && job.totalBytes > 0 ? job.totalBytes : null;
    if (total == null) {
      allKnown = false;
      break;
    }
    knownTotal += total;
    knownBytes += Math.max(0, Math.min(total, job.bytesDownloaded));
  }

  if (!allKnown || knownTotal <= 0) {
    return {
      progressPercent: null,
      bytesDownloaded: null,
      totalBytes: null,
      indeterminate: true,
    };
  }

  return {
    progressPercent: Math.max(
      0,
      Math.min(100, Math.floor((knownBytes / knownTotal) * 100)),
    ),
    bytesDownloaded: knownBytes,
    totalBytes: knownTotal,
    indeterminate: false,
  };
}

/** Sanitize user-facing title — never a URL. */
export function sanitizeNotificationTitle(
  title: string | null | undefined,
  fileName: string | null | undefined,
): string {
  const primary = (title ?? '').trim();
  if (primary && !looksLikeUrl(primary)) {
    return truncate(primary, 80);
  }
  const secondary = (fileName ?? '').trim();
  if (secondary && !looksLikeUrl(secondary)) {
    return truncate(secondary, 80);
  }
  return 'Download';
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.includes('://');
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}
