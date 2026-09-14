export function extractHostname(url: string): string {
  try {
    const normalized = normalizeUrl(url);
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function normalizeUrl(url: string): string {
  const trimmed = url.trim();

  if (!trimmed) {
    return trimmed;
  }

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

export function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}
