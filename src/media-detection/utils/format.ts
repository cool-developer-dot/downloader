/**
 * Pure display formatters — never invent missing values.
 */

export function formatDuration(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }

  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatFileSize(bytes: number | null | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    return null;
  }

  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatBitrate(bps: number | null | undefined): string | null {
  if (typeof bps !== 'number' || !Number.isFinite(bps) || bps <= 0) {
    return null;
  }

  if (bps >= 1_000_000) {
    return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  }
  if (bps >= 1_000) {
    return `${Math.round(bps / 1_000)} kbps`;
  }
  return `${Math.round(bps)} bps`;
}

export function formatConfidence(score: number | null | undefined): string | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return null;
  }
  return `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
}

export function formatContainer(container: string | null | undefined): string | null {
  if (!container || container === 'unknown') {
    return null;
  }
  return container.toUpperCase();
}

export function formatWebsite(source: string | null | undefined, pageUrl?: string | null): string | null {
  if (source?.trim()) {
    return source.trim();
  }
  if (!pageUrl) {
    return null;
  }
  try {
    return new URL(pageUrl).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
