/**
 * Same-content navigation identity for general websites.
 * Generation follows public content identity, not player/query/hash noise.
 */

import { extractGeneralPageVideoId } from './general-content-identity';

export type GeneralContentChangeReason =
  | 'navigation'
  | 'spa_path'
  | 'content_id'
  | 'same_content'
  | 'sync';

export type GeneralContentNavigationDecision = {
  sameContent: boolean;
  didVideoIdentityChange: boolean;
  reason: GeneralContentChangeReason;
  oldIdentity: string | null;
  newIdentity: string | null;
  oldPathClass: string;
  newPathClass: string;
};

const TRACKING_QUERY_PREFIXES = [
  'utm_',
  'fbclid',
  'gclid',
  'mc_',
  'ref',
  'share',
  'si',
  'igsh',
  'igsi',
] as const;

function stripWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

function canonicalizePath(pathname: string): string {
  let path = pathname;
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return path || '/';
}

function pathClassOf(pathname: string): string {
  const path = canonicalizePath(pathname);
  if (/\/(?:video|watch|embed|media)\/[a-z0-9_-]+$/i.test(path)) {
    return 'content-id-path';
  }
  if (/^\/[a-z0-9_-]+$/i.test(path) && /\d/.test(path)) {
    return 'short-id-path';
  }
  if (path.includes('/player/')) {
    return 'player-chrome';
  }
  return 'generic-path';
}

function contentQueryId(parsed: URL): string | null {
  const video = parsed.searchParams.get('video') ?? parsed.searchParams.get('v');
  if (video && /^[A-Za-z0-9_-]{5,32}$/.test(video)) {
    return video;
  }
  return null;
}

function meaningfulQueryIdentity(parsed: URL): string {
  const params = [...parsed.searchParams.entries()]
    .filter(([key]) => {
      const lower = key.toLowerCase();
      return !TRACKING_QUERY_PREFIXES.some((prefix) => lower.startsWith(prefix));
    })
    .filter(([key]) => {
      const lower = key.toLowerCase();
      return lower === 'v' || lower === 'video' || lower === 'id';
    })
    .sort(([a], [b]) => a.localeCompare(b));
  if (params.length === 0) {
    return '';
  }
  return params.map(([k, v]) => `${k.toLowerCase()}=${v}`).join('&');
}

/**
 * Stable public content key: host-root + video id when present, else canonical path.
 * Ignores fragment and tracking query. Does not ignore content ids in `v`/`video`.
 */
export function canonicalizeGeneralContentKey(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  const parsed = safeUrl(url);
  if (!parsed) {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }
  const host = stripWww(parsed.hostname);
  const videoId = extractGeneralPageVideoId(url) ?? contentQueryId(parsed);
  if (videoId) {
    return `id:${host}:${videoId}`;
  }
  const path = canonicalizePath(parsed.pathname);
  const q = meaningfulQueryIdentity(parsed);
  return `path:${host}${path}${q ? `?${q}` : ''}`;
}

export function classifyGeneralContentNavigation(
  oldUrl: string | null | undefined,
  newUrl: string | null | undefined,
): GeneralContentNavigationDecision {
  const oldKey = canonicalizeGeneralContentKey(oldUrl ?? null);
  const newKey = canonicalizeGeneralContentKey(newUrl ?? null);
  const oldParsed = oldUrl ? safeUrl(oldUrl) : null;
  const newParsed = newUrl ? safeUrl(newUrl) : null;
  const oldId = extractGeneralPageVideoId(oldUrl);
  const newId = extractGeneralPageVideoId(newUrl);
  const didVideoIdentityChange = Boolean(oldId && newId && oldId !== newId);

  const oldPathClass = oldParsed ? pathClassOf(oldParsed.pathname) : 'none';
  const newPathClass = newParsed ? pathClassOf(newParsed.pathname) : 'none';

  if (!oldKey || !newKey) {
    return {
      sameContent: false,
      didVideoIdentityChange,
      reason: 'navigation',
      oldIdentity: oldKey,
      newIdentity: newKey,
      oldPathClass,
      newPathClass,
    };
  }

  if (oldKey === newKey) {
    return {
      sameContent: true,
      didVideoIdentityChange: false,
      reason: 'same_content',
      oldIdentity: oldKey,
      newIdentity: newKey,
      oldPathClass,
      newPathClass,
    };
  }

  if (didVideoIdentityChange) {
    return {
      sameContent: false,
      didVideoIdentityChange: true,
      reason: 'content_id',
      oldIdentity: oldKey,
      newIdentity: newKey,
      oldPathClass,
      newPathClass,
    };
  }

  const oldPath = oldParsed ? `${stripWww(oldParsed.hostname)}${canonicalizePath(oldParsed.pathname)}` : null;
  const newPath = newParsed ? `${stripWww(newParsed.hostname)}${canonicalizePath(newParsed.pathname)}` : null;
  const pathChanged = Boolean(oldPath && newPath && oldPath !== newPath);

  return {
    sameContent: false,
    didVideoIdentityChange: false,
    reason: pathChanged ? 'spa_path' : 'navigation',
    oldIdentity: oldKey,
    newIdentity: newKey,
    oldPathClass,
    newPathClass,
  };
}

export function isSameGeneralContentNavigation(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return classifyGeneralContentNavigation(a, b).sameContent;
}
