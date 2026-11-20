// VidoraX Remote control (P6) — pure helpers of the Web UI, also run by the Node tests
// (modules/vidorax-media/remote-web.test.ts). No DOM here.

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 1536 → "1.5 KB"; null/negative → "". */
export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

/** Bytes per second → "1.5 MB/s"; nothing for 0 or unknown. */
export function formatSpeed(bytesPerSecond) {
  if (typeof bytesPerSecond !== 'number' || bytesPerSecond <= 0) return '';
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** Seconds → "1:05" or "1:02:03"; nothing for unknown. */
export function formatEta(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

/** 0..1 → whole percent 0..100, or null when unknown. */
export function percent(fraction) {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return null;
  return Math.max(0, Math.min(100, Math.floor(fraction * 100)));
}

/** The string key that names a download state. */
export function stateKey(state) {
  const known = [
    'queued',
    'probing',
    'downloading',
    'paused',
    'waiting_network',
    'waiting_retry',
    'waiting_conditions',
    'recording',
    'processing',
    'completed',
    'failed',
    'cancelled',
  ];
  return known.includes(state) ? `state_${state}` : 'state_queued';
}

/** "Chrome on macOS" from a User-Agent: what the phone lists this browser as. */
export function deviceName(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /OPR\//.test(ua)
        ? 'Opera'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : '';
  return os ? `${browser} on ${os}` : browser;
}

/** The PIN a scanned QR code put in the address (`#pin=123456`), or null. */
export function pinFromHash(hash) {
  const match = /(?:^#|&)pin=(\d{6})(?:&|$)/.exec(typeof hash === 'string' ? hash : '');
  return match ? match[1] : null;
}

/** Only http(s) addresses become links in the page; anything else is shown as text. */
export function safeHttpUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** A typed or pasted link, trimmed; null when it is not http(s). */
export function linkFromInput(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  return safeHttpUrl(withScheme);
}

/** Whether a link request is still being checked by the phone. */
export function isLinkPending(status) {
  return status === 'checking' || status === 'waiting_for_app';
}
