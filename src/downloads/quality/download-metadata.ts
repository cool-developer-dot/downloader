/**
 * User-facing download title and filename generation.
 * Never expose internal hash IDs as the primary title.
 */

const HASH_LIKE = /^[a-f0-9]{24,64}$/i;
const CDN_SEGMENT = /^[a-z0-9_-]{20,}$/i;

function isHashLikeTitle(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  if (HASH_LIKE.test(trimmed)) {
    return true;
  }
  if (CDN_SEGMENT.test(trimmed) && !trimmed.includes(' ')) {
    return true;
  }
  return false;
}

function platformLabel(platform: string): string | null {
  const normalized = platform.trim().toUpperCase();
  if (normalized === 'TIKTOK' || normalized.includes('TIKTOK')) {
    return 'TikTok Video';
  }
  if (normalized === 'INSTAGRAM' || normalized.includes('INSTAGRAM')) {
    return 'Instagram Reel';
  }
  if (normalized === 'YOUTUBE' || normalized.includes('YOUTUBE')) {
    return 'YouTube Video';
  }
  return null;
}

function formatTimestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function sanitizeFileBase(value: string): string {
  return value
    .trim()
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

export function resolveDownloadTitle(input: {
  title?: string | null;
  platform?: string | null;
  pageTitle?: string | null;
}): string {
  const candidates = [input.title, input.pageTitle].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!isHashLikeTitle(trimmed)) {
      return trimmed.slice(0, 255);
    }
  }

  const label = platformLabel(input.platform ?? '');
  if (label) {
    return label;
  }

  return 'Download';
}

function isGenericPlatformTitle(title: string, platform: string): boolean {
  const normalized = title.trim().toLowerCase();
  const plat = platform.trim().toUpperCase();
  if (plat.includes('TIKTOK') && normalized === 'tiktok video') {
    return true;
  }
  if (plat.includes('INSTAGRAM') && (normalized === 'instagram reel' || normalized === 'instagram video')) {
    return true;
  }
  return normalized === 'download';
}

export function resolveDownloadFileName(input: {
  title: string;
  platform?: string | null;
  containerExt?: string | null;
}): string {
  const ext = (input.containerExt ?? 'mp4').replace(/^\./, '').toLowerCase() || 'mp4';
  const platform = input.platform?.trim().toUpperCase() ?? 'OTHER';

  const sanitized = sanitizeFileBase(input.title);
  if (
    sanitized &&
    !isHashLikeTitle(sanitized) &&
    !isGenericPlatformTitle(input.title, platform) &&
    sanitized.toLowerCase() !== 'download'
  ) {
    const withExt = sanitized.includes('.') ? sanitized : `${sanitized}.${ext}`;
    return withExt.slice(0, 180);
  }

  const prefix =
    platform.includes('TIKTOK')
      ? 'VidoraX_TikTok'
      : platform.includes('INSTAGRAM')
        ? 'VidoraX_Instagram'
        : 'VidoraX_Video';

  return `${prefix}_${formatTimestamp()}.${ext}`.slice(0, 180);
}

export { isHashLikeTitle };
