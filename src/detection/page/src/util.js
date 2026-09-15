/* global vdx */
// Shared helpers. Every value they receive comes from the page and is treated as untrusted.

const MAX_URL_LENGTH = 4096;
const NativeURL = window.URL;
const setTimer = window.setTimeout.bind(window);
const clearTimer = window.clearTimeout.bind(window);

function noop() {}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Strings lifted out of script text, or JSON that was encoded twice, still carry JSON escapes such as \u0026
// and \/. Decoding them as a JSON string literal handles every escape exactly.
function unescapeJsonText(value) {
  if (value.indexOf('\\') < 0 || value.indexOf('"') >= 0) return value;
  try {
    return JSON.parse('"' + value + '"');
  } catch (_error) {
    return value;
  }
}

function decodeHtmlAmpersands(value) {
  return typeof value === 'string' ? value.replace(/&amp;/g, '&') : value;
}

/** Absolute http(s) URL or null. Relative values resolve against `base` when one is given. */
function httpUrl(value, base) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  let parsed;
  try {
    parsed = base ? new NativeURL(unescapeJsonText(trimmed), base) : new NativeURL(unescapeJsonText(trimmed));
  } catch (_error) {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  return parsed.href.length > MAX_URL_LENGTH ? null : parsed.href;
}

function positiveNumber(value) {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof number === 'number' && isFinite(number) && number > 0 ? number : undefined;
}

function positiveInt(value) {
  const number = positiveNumber(value);
  return number === undefined ? undefined : Math.round(number);
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return undefined;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return undefined;
  return collapsed.length > maxLength ? collapsed.slice(0, maxLength - 1) + '\u2026' : collapsed;
}

function hostMatches(host, domain) {
  return host === domain || host.slice(-(domain.length + 1)) === '.' + domain;
}

const SITE_DOMAINS = [
  ['instagram', ['instagram.com', 'cdninstagram.com']],
  ['facebook', ['facebook.com', 'fb.watch', 'fbcdn.net']],
  ['tiktok', ['tiktok.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokv.com']],
  ['twitter', ['x.com', 'twitter.com', 'twimg.com']],
  ['reddit', ['reddit.com', 'redd.it', 'redditmedia.com']],
  ['vimeo', ['vimeo.com', 'vimeocdn.com']],
  ['dailymotion', ['dailymotion.com', 'dmcdn.net']],
  ['twitch', ['twitch.tv', 'ttvnw.net', 'jtvnw.net']],
  ['pinterest', ['pinterest.com', 'pinimg.com']],
  ['snapchat', ['snapchat.com', 'sc-cdn.net']],
  ['linkedin', ['linkedin.com', 'licdn.com']],
];

function siteForHost(host) {
  const name = String(host || '').toLowerCase();
  for (let i = 0; i < SITE_DOMAINS.length; i++) {
    const domains = SITE_DOMAINS[i][1];
    for (let j = 0; j < domains.length; j++) {
      if (hostMatches(name, domains[j])) return SITE_DOMAINS[i][0];
    }
  }
  // Pinterest also serves country domains such as pinterest.co.uk and pinterest.de.
  return /(^|\.)pinterest\.[a-z.]+$/.test(name) ? 'pinterest' : 'web';
}

function isYouTubeHost(host) {
  const name = String(host || '').toLowerCase();
  return ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googlevideo.com'].some((domain) =>
    hostMatches(name, domain),
  );
}

/** FNV-1a, 32 bits, base 36. */
function hashString(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** UTF-8 size of a string; surrogate pairs are over-counted by two bytes, which is safe for caps. */
function utf8Length(value) {
  let bytes = value.length;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0x800) bytes += 2;
    else if (code >= 0x80) bytes += 1;
  }
  return bytes;
}

function extensionOf(url) {
  const match = /\.([a-z0-9]{2,5})$/i.exec(url.split(/[?#]/)[0]);
  return match ? match[1].toLowerCase() : '';
}

/** 'progressive' | 'hls' | 'dash' from a MIME type or file extension, or null when neither says media. */
function streamKind(url, mimeType) {
  const type = typeof mimeType === 'string' ? mimeType.toLowerCase() : '';
  if (type.indexOf('mpegurl') >= 0) return 'hls';
  if (type.indexOf('dash+xml') >= 0) return 'dash';
  switch (extensionOf(url)) {
    case 'm3u8':
      return 'hls';
    case 'mpd':
      return 'dash';
    case 'mp4':
    case 'm4v':
    case 'mov':
    case 'webm':
    case 'mkv':
      return 'progressive';
    default:
      return type.indexOf('video/') === 0 ? 'progressive' : null;
  }
}

/** Seconds from an ISO 8601 duration such as PT1M30.5S. */
function isoDurationSeconds(value) {
  const match = typeof value === 'string' ? /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(value) : null;
  if (!match) return positiveNumber(value);
  const [, days, hours, minutes, seconds] = match;
  return positiveNumber(
    Number(days || 0) * 86400 + Number(hours || 0) * 3600 + Number(minutes || 0) * 60 + Number(seconds || 0),
  );
}

/** Wraps a listener or timer callback so its errors never reach the page. */
function guard(callback) {
  return function (...args) {
    try {
      return callback.apply(this, args);
    } catch (_error) {
      return undefined;
    }
  };
}

function whenIdle(task) {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(task, { timeout: 1000 });
  else setTimer(task, 0);
}

// Some anti-bot scripts reject pages whose fetch or XHR methods no longer stringify as native code.
function disguise(wrapper, original) {
  try {
    Object.defineProperty(wrapper, 'toString', {
      value: () => Function.prototype.toString.call(original),
      configurable: true,
      writable: true,
    });
  } catch (_error) {
    // The wrapper still works; it just stringifies as itself.
  }
  return wrapper;
}

vdx.util = {
  noop,
  isObject,
  unescapeJsonText,
  decodeHtmlAmpersands,
  httpUrl,
  positiveNumber,
  positiveInt,
  cleanText,
  siteForHost,
  isYouTubeHost,
  hashString,
  utf8Length,
  streamKind,
  isoDurationSeconds,
  guard,
  whenIdle,
  disguise,
  setTimer,
  clearTimer,
};
