// VidoraX Bridge (P6 #500) — the extension's pure logic, shared by the popup and the background worker and
// tested under Node (src/remote/extension-core.test.ts). No browser APIs here.

/**
 * The phone's Remote control address as an origin (`http://192.168.1.20:41234`), from what the user typed or
 * pasted (with or without `http://`, a path or the `#pin=` part of the QR address). Null for anything that is
 * not a plain http address with a port — the phone never serves https or a default port.
 */
export function normalizePhoneAddress(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' || !url.port || url.username || url.password) return null;
  return `http://${url.hostname}:${url.port}`;
}

/** The PIN in a pasted QR address (`…/#pin=123456`), or null. */
export function pinFromAddress(input) {
  const match = /#(?:.*&)?pin=(\d{6})(?:&|$)/.exec(typeof input === 'string' ? input : '');
  return match ? match[1] : null;
}

/** The host-permission pattern for the phone's origin (asked for at pairing). */
export function originPattern(origin) {
  return `${origin}/*`;
}

function httpUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * What "Send to VidoraX" sends for a context-menu click. A video element's own address is used when it is a
 * real file address; a `blob:` / MediaSource player sends the page instead, which VidoraX reads for its video.
 */
export function urlToSend({ menuItemId, linkUrl, srcUrl, pageUrl } = {}) {
  if (menuItemId === 'send-link') return httpUrl(linkUrl);
  if (menuItemId === 'send-video') return httpUrl(srcUrl) ?? httpUrl(pageUrl);
  if (menuItemId === 'send-page') return httpUrl(pageUrl);
  return httpUrl(linkUrl) ?? httpUrl(srcUrl) ?? httpUrl(pageUrl);
}

const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|flv|ts|m3u8|mpd|avi|3gp)(?:$|[?#])/i;

/** Whether an address looks like a video file or stream (by its path's extension). */
export function looksLikeVideo(value) {
  const url = httpUrl(value);
  if (!url) return false;
  return VIDEO_EXTENSIONS.test(new URL(url).pathname + new URL(url).search);
}

/**
 * The popup's list of the page's video links, from what the page script collected: `<video>`/`<source>` addresses
 * and links whose path ends in a video extension. Only http(s), no duplicates, at most [limit].
 */
export function videoLinksFrom(snapshot, limit = 50) {
  const seen = new Set();
  const out = [];
  const add = (url, label, kind) => {
    const href = httpUrl(url);
    if (!href || seen.has(href) || out.length >= limit) return;
    seen.add(href);
    out.push({ url: href, label: (typeof label === 'string' ? label.trim() : '').slice(0, 120) || fileName(href), kind });
  };
  for (const media of snapshot?.media ?? []) add(media.url, media.label, 'video');
  for (const link of snapshot?.links ?? []) {
    if (looksLikeVideo(link.url)) add(link.url, link.label, 'link');
  }
  return out;
}

export function fileName(url) {
  try {
    const path = new URL(url).pathname;
    const last = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
    return last || new URL(url).host;
  } catch {
    return url;
  }
}

/** The text shown for a link request's status ("added", "duplicate", "needs_review", "refused", …). */
export function outcomeKey(status) {
  switch (status) {
    case 'added':
      return 'sentAdded';
    case 'duplicate':
      return 'sentDuplicate';
    case 'needs_review':
      return 'sentReview';
    case 'refused':
      return 'sentRefused';
    case 'waiting_for_app':
      return 'sentWaiting';
    default:
      return 'sentChecking';
  }
}

/** A short name for the phone's list of paired browsers. */
export function browserName(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  if (/Edg\//.test(ua)) return 'VidoraX Bridge (Edge)';
  if (/Firefox\//.test(ua)) return 'VidoraX Bridge (Firefox)';
  if (/Chrome\//.test(ua)) return 'VidoraX Bridge (Chrome)';
  return 'VidoraX Bridge';
}
