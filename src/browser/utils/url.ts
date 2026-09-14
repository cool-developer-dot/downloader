import {
  BROWSER_ALLOWED_SCHEMES,
  BROWSER_BLOCKED_SCHEMES,
  BROWSER_EXTERNAL_SCHEMES,
  BROWSER_HOMEPAGE,
  BROWSER_INVALID_INPUT_PATTERNS,
  BROWSER_SEARCH_BASE_URL,
  isSocialNativeAppScheme as matchSocialNativeAppScheme,
} from '@/browser/constants/browser.constants';
import type {
  BrowserSecurityLevel,
  NavigationIntent,
} from '@/browser/types';

const IPV4_HOST =
  /^(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:\/.*)?$/;

const LOOKS_LIKE_HOST =
  /^(?:www\.)?(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?::\d{1,5})?(?:[/?#].*)?$/i;

const LOCALHOST_HOST = /^localhost(?::\d{1,5})?(?:[/?#].*)?$/i;

const SCHEME_PREFIX = /^([a-zA-Z][a-zA-Z\d+\-.]*):/;

const INVALID_MESSAGES = {
  empty: 'Enter a website address or search the web.',
  invalid: 'That doesn’t look like a valid address. Try a website or a search.',
  blocked: 'This type of address can’t be opened for security reasons.',
  incomplete: 'That address is incomplete. Try adding a full website name.',
} as const;

export function isBrowserHomeUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed === BROWSER_HOMEPAGE ||
    trimmed === 'vidorax://home/' ||
    trimmed === 'about:vidorax-home'
  );
}

/** True when the URL is a shareable / bookmarkable http(s) page — not home or blank. */
export function isValidBrowserPageUrl(url: string): boolean {
  if (!url.trim() || isBrowserHomeUrl(url)) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isSecureUrl(url: string): boolean {
  if (isBrowserHomeUrl(url)) {
    return true;
  }

  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function getSecurityLevel(url: string): BrowserSecurityLevel {
  if (!url || isBrowserHomeUrl(url)) {
    return 'neutral';
  }

  try {
    const protocol = new URL(url).protocol.toLowerCase();
    if (protocol === 'https:') {
      return 'secure';
    }
    if (protocol === 'http:') {
      return 'insecure';
    }
    if (protocol === 'about:') {
      return 'neutral';
    }
    return 'warning';
  } catch {
    return 'warning';
  }
}

export function hasAllowedScheme(url: string): boolean {
  if (isBrowserHomeUrl(url)) {
    return true;
  }

  try {
    const protocol = new URL(url).protocol.toLowerCase();
    return (BROWSER_ALLOWED_SCHEMES as readonly string[]).includes(protocol);
  } catch {
    return false;
  }
}

export function isExternalScheme(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return (BROWSER_EXTERNAL_SCHEMES as readonly string[]).some((scheme) =>
    lower.startsWith(scheme),
  );
}

export function isBlockedScheme(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return (BROWSER_BLOCKED_SCHEMES as readonly string[]).some((scheme) =>
    lower.startsWith(scheme),
  );
}

export function isSocialNativeAppScheme(url: string): boolean {
  return matchSocialNativeAppScheme(url);
}

function extractScheme(input: string): string | null {
  const match = SCHEME_PREFIX.exec(input.trim());
  return match ? `${match[1].toLowerCase()}:` : null;
}

function isInvalidLiteral(input: string): boolean {
  return (BROWSER_INVALID_INPUT_PATTERNS as readonly RegExp[]).some((pattern) =>
    pattern.test(input),
  );
}

function isValidIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      return false;
    }
    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}

function normalizeRootUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (
      (parsed.pathname === '/' || parsed.pathname === '') &&
      !parsed.search &&
      !parsed.hash
    ) {
      parsed.pathname = '';
      return parsed.toString().replace(/\/$/, '') || parsed.origin;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function looksLikeNavigableUrl(input: string): boolean {
  const intent = classifyNavigationInput(input);
  return intent.kind === 'navigate';
}

export function normalizeBrowserUrl(input: string): string {
  const intent = classifyNavigationInput(input);
  if (intent.kind === 'navigate') {
    return intent.url;
  }
  if (intent.kind === 'search') {
    return intent.url;
  }
  return input.trim();
}

export function buildSearchUrl(query: string): string {
  const normalized = query.trim().replace(/\s+/g, ' ');
  const url = new URL(BROWSER_SEARCH_BASE_URL);
  url.searchParams.set('q', normalized);
  return url.toString();
}

/**
 * Classifies omnibox input into a navigation intent.
 * Pure function — no store, no WebView, no side effects.
 */
export function classifyNavigationInput(rawInput: string): NavigationIntent {
  const trimmed = rawInput.trim();

  if (!trimmed) {
    return { kind: 'empty' };
  }

  if (isBrowserHomeUrl(trimmed)) {
    return { kind: 'home' };
  }

  if (isInvalidLiteral(trimmed)) {
    return { kind: 'invalid', category: 'invalid', message: INVALID_MESSAGES.invalid };
  }

  if (isBlockedScheme(trimmed)) {
    return { kind: 'blocked', category: 'blocked', message: INVALID_MESSAGES.blocked };
  }

  const scheme = extractScheme(trimmed);

  if (scheme) {
    if ((BROWSER_BLOCKED_SCHEMES as readonly string[]).includes(scheme)) {
      return { kind: 'blocked', category: 'blocked', message: INVALID_MESSAGES.blocked };
    }

    if (scheme === 'http:' || scheme === 'https:') {
      try {
        const parsed = new URL(trimmed);
        if (!parsed.hostname) {
          return {
            kind: 'invalid',
            category: 'invalid',
            message: INVALID_MESSAGES.incomplete,
          };
        }

        if (scheme === 'http:') {
          return {
            kind: 'navigate',
            category: 'http_url',
            url: normalizeRootUrl(parsed.toString()),
          };
        }

        return {
          kind: 'navigate',
          category: 'https_url',
          url: normalizeRootUrl(parsed.toString()),
        };
      } catch {
        return { kind: 'invalid', category: 'invalid', message: INVALID_MESSAGES.invalid };
      }
    }

    if (isExternalScheme(trimmed)) {
      return { kind: 'invalid', category: 'invalid', message: INVALID_MESSAGES.invalid };
    }

    // Unknown / malformed scheme tokens like "invalid::url"
    return { kind: 'invalid', category: 'invalid', message: INVALID_MESSAGES.invalid };
  }

  // Search queries contain whitespace
  if (/\s/.test(trimmed)) {
    const query = trimmed.replace(/\s+/g, ' ');
    return { kind: 'search', query, url: buildSearchUrl(query) };
  }

  const lower = trimmed.toLowerCase();

  if (LOCALHOST_HOST.test(lower)) {
    return {
      kind: 'navigate',
      category: 'localhost',
      url: normalizeRootUrl(`http://${lower}`),
    };
  }

  if (IPV4_HOST.test(lower)) {
    const host = lower.split(/[/:?#]/)[0] ?? lower;
    if (!isValidIpv4(host)) {
      return { kind: 'invalid', category: 'invalid', message: INVALID_MESSAGES.invalid };
    }
    return {
      kind: 'navigate',
      category: 'ip',
      url: normalizeRootUrl(`http://${lower}`),
    };
  }

  if (LOOKS_LIKE_HOST.test(lower)) {
    const category = lower.startsWith('www.') ? 'www_domain' : 'domain';
    return {
      kind: 'navigate',
      category,
      url: normalizeRootUrl(`https://${lower}`),
    };
  }

  // Single tokens without a TLD → search (e.g. "reactnative")
  if (/^[a-zA-Z0-9][a-zA-Z0-9-_]*$/i.test(trimmed)) {
    return { kind: 'search', query: trimmed, url: buildSearchUrl(trimmed) };
  }

  // Symbols-only junk
  if (/^[^a-zA-Z0-9]+$/.test(trimmed)) {
    return { kind: 'invalid', category: 'invalid', message: INVALID_MESSAGES.invalid };
  }

  return { kind: 'search', query: trimmed, url: buildSearchUrl(trimmed) };
}

/**
 * Resolves free-form address-bar input into a concrete navigation URL.
 * Returns null for empty / invalid / blocked input.
 */
export function resolveNavigationInput(input: string): string | null {
  const intent = classifyNavigationInput(input);

  switch (intent.kind) {
    case 'navigate':
    case 'search':
      return intent.url;
    case 'home':
      return BROWSER_HOMEPAGE;
    default:
      return null;
  }
}

/** Compact display string for the address bar (hostname + path, no scheme). */
export function formatDisplayUrl(url: string): string {
  if (isBrowserHomeUrl(url)) {
    return '';
  }

  try {
    const parsed = new URL(url);

    if (parsed.protocol === 'about:') {
      return '';
    }

    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    const displayPath = path === '/' ? '' : path;
    return `${parsed.host}${displayPath}`;
  } catch {
    return url;
  }
}

export function extractPageHostname(url: string): string {
  if (isBrowserHomeUrl(url)) {
    return '';
  }

  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function getNavigationValidationMessage(input: string): string | null {
  const intent = classifyNavigationInput(input);
  if (intent.kind === 'invalid' || intent.kind === 'blocked') {
    return intent.message;
  }
  if (intent.kind === 'empty') {
    return null;
  }
  return null;
}
