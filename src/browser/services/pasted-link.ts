/**
 * Which links the direct analyzer reads before the tab loads them: a content page on a public http(s) host — a path
 * beyond the site root, or a query naming something. A site's home page, a search, YouTube (refused by policy) and
 * private addresses load directly.
 */

const POLICY_BLOCKED_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googlevideo.com'];

/**
 * A YouTube link (any youtube.com host — www, m, music —, youtu.be short links, youtube-nocookie embeds, the
 * googlevideo media hosts, or the app schemes). VidoraX never downloads from YouTube: such a link pasted, shared or
 * opened with VidoraX is refused before any navigation or fetch.
 */
export function isYouTubeLink(raw: string | null | undefined): boolean {
  const text = raw?.trim() ?? '';
  if (!text) {
    return false;
  }
  if (/^(?:vnd\.)?youtube:/i.test(text)) {
    return true;
  }
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  return POLICY_BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function isPrivateOrLocal(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h.includes('.') && !h.includes(':')) {
    return true;
  }
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa')) {
    return true;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return h.includes(':');
}

/** Search engines' result pages are never a video's page. */
function isSearchPage(url: URL): boolean {
  return /(^|\.)(google|bing|duckduckgo|yahoo|yandex|baidu)\.[a-z.]+$/i.test(url.hostname) && /^\/(search|html|s)?\/?$/i.test(url.pathname);
}

export function shouldAnalyzePastedLink(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (!host || isPrivateOrLocal(host)) {
    return false;
  }
  if (POLICY_BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) {
    return false;
  }
  if (isSearchPage(url)) {
    return false;
  }
  const hasPath = url.pathname.replace(/\/+$/, '').length > 0;
  const hasQuery = [...url.searchParams.keys()].some((key) => !/^(?:utm_.*|ref|fbclid|gclid|hl|lang)$/i.test(key));
  return hasPath || hasQuery;
}
