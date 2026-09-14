/**
 * Phase 2A — centralized DEV-only browser runtime audit diagnostics.
 * Structured, sanitized events for forensic tracing. Never logs secrets.
 */

export type BrowserDiagTag =
  | 'BrowserNav'
  | 'BrowserLoad'
  | 'BrowserError'
  | 'BrowserSSL'
  | 'BrowserSession'
  | 'BrowserWindow'
  | 'BrowserMedia'
  | 'BrowserWebView'
  | 'BrowserHistory'
  | 'BrowserDesktop';

export type BrowserNavEvent =
  | 'request'
  | 'allow'
  | 'block'
  | 'chrome_load'
  | 'redirect'
  | 'commit'
  | 'back'
  | 'forward'
  | 'android_back'
  | 'reload'
  | 'external'
  | 'home'
  | 'stop'
  | 'popup';

export type BrowserLoadPhase = 'start' | 'progress' | 'commit' | 'end';

export type BrowserErrorClassification =
  | 'offline'
  | 'dns'
  | 'aborted'
  | 'reset'
  | 'timeout'
  | 'http'
  | 'ssl'
  | 'render_process'
  | 'malformed_url'
  | 'unknown';

type DiagValue = string | number | boolean | null | undefined;

export type BrowserDiagFields = Record<string, DiagValue>;

const BLOCKED_KEYS = new Set([
  'cookie',
  'cookies',
  'authorization',
  'set-cookie',
  'password',
  'passwd',
  'otp',
  'token',
  'accesstoken',
  'idtoken',
  'refreshtoken',
  'clientsecret',
  'query',
  'fragment',
  'signedurl',
]);

const loadProgressThrottle = new Map<string, number>();
const LOAD_PROGRESS_THROTTLE_MS = 2000;

function isDev(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

function sanitizeKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (BLOCKED_KEYS.has(lower)) {
    return false;
  }
  if (
    lower.includes('cookie') ||
    lower.includes('authorization') ||
    (lower.includes('token') && !lower.includes('navigationid'))
  ) {
    return false;
  }
  return true;
}

function sanitizeFields(fields: BrowserDiagFields): BrowserDiagFields {
  const out: BrowserDiagFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!sanitizeKey(key)) {
      continue;
    }
    if (typeof value === 'string' && value.startsWith('http')) {
      const sanitized = sanitizeBrowserUrl(value);
      out[key] = sanitized.safeHost ?? '[invalid-url]';
      if (sanitized.safePathPattern) {
        out[`${key}Path`] = sanitized.safePathPattern;
      }
      if (sanitized.queryPresent) {
        out[`${key}QueryPresent`] = true;
      }
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Strip query, fragment, and credentials from URLs for diagnostics. */
export function sanitizeBrowserUrl(url: string | null | undefined): {
  scheme: string | null;
  safeHost: string | null;
  safePathPattern: string | null;
  queryPresent: boolean;
} {
  if (!url) {
    return {
      scheme: null,
      safeHost: null,
      safePathPattern: null,
      queryPresent: false,
    };
  }

  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const safePathPattern =
      segments.length === 0
        ? '/'
        : `/${segments[0]}${segments.length > 1 ? '/…' : ''}`;
    return {
      scheme: parsed.protocol.replace(':', ''),
      safeHost: parsed.hostname || null,
      safePathPattern,
      queryPresent: parsed.search.length > 1,
    };
  } catch {
    return {
      scheme: null,
      safeHost: null,
      safePathPattern: null,
      queryPresent: false,
    };
  }
}

export function safeBrowserHost(url: string | null | undefined): string | null {
  return sanitizeBrowserUrl(url).safeHost;
}

export function classifyBrowserLoadError(input: {
  description?: string;
  code?: number | string;
}): BrowserErrorClassification {
  const description = (input.description ?? '').toLowerCase();
  const code = String(input.code ?? '').toLowerCase();

  if (
    description.includes('ssl') ||
    description.includes('cert') ||
    description.includes('err_cert') ||
    description.includes('err_ssl') ||
    code.includes('ssl')
  ) {
    return 'ssl';
  }

  if (
    description.includes('timeout') ||
    description.includes('timed out') ||
    description.includes('err_connection_timed_out') ||
    description.includes('err_timed_out')
  ) {
    return 'timeout';
  }

  if (
    description.includes('err_connection_aborted') ||
    description.includes('connection aborted') ||
    description.includes('err_aborted')
  ) {
    return 'aborted';
  }

  if (
    description.includes('err_connection_reset') ||
    description.includes('connection reset')
  ) {
    return 'reset';
  }

  if (
    description.includes('err_internet_disconnected') ||
    description.includes('offline') ||
    description.includes('network error')
  ) {
    return 'offline';
  }

  if (
    description.includes('err_name_not_resolved') ||
    description.includes('dns') ||
    description.includes('host not found') ||
    description.includes('err_connection_refused') ||
    description.includes('err_address_unreachable')
  ) {
    return 'dns';
  }

  if (description.includes('http') && /\b[45]\d{2}\b/.test(description)) {
    return 'http';
  }

  if (
    description.includes('render process') ||
    description.includes('render_process')
  ) {
    return 'render_process';
  }

  if (
    description.includes('invalid url') ||
    description.includes('malformed') ||
    description.includes('err_invalid_url')
  ) {
    return 'malformed_url';
  }

  return 'unknown';
}

function logBrowserDiag(tag: BrowserDiagTag, fields: BrowserDiagFields = {}): void {
  if (!isDev()) {
    return;
  }
  console.log(`[${tag}]`, sanitizeFields(fields));
}

export function logBrowserNav(
  navigationId: number,
  event: BrowserNavEvent,
  fields: BrowserDiagFields = {},
): void {
  logBrowserDiag('BrowserNav', { navigationId, event, ...fields });
}

export function logBrowserLoad(
  navigationId: number,
  phase: BrowserLoadPhase,
  fields: BrowserDiagFields = {},
): void {
  if (phase === 'progress') {
    const key = `${navigationId}:${fields.progressBucket ?? 'p'}`;
    const now = Date.now();
    const last = loadProgressThrottle.get(key) ?? 0;
    if (now - last < LOAD_PROGRESS_THROTTLE_MS) {
      return;
    }
    loadProgressThrottle.set(key, now);
  }

  logBrowserDiag('BrowserLoad', { navigationId, phase, ...fields });
}

export function logBrowserError(
  navigationId: number,
  fields: BrowserDiagFields & {
    errorCode?: number | string;
    safeDescription?: string;
    classification?: BrowserErrorClassification;
  } = {},
): void {
  logBrowserDiag('BrowserError', { navigationId, ...fields });
}

export function logBrowserSsl(
  navigationId: number,
  fields: BrowserDiagFields & {
    certificateErrorType?: string;
    blocked?: boolean;
  } = {},
): void {
  logBrowserDiag('BrowserSSL', { navigationId, blocked: true, ...fields });
}

export function logBrowserSession(fields: BrowserDiagFields = {}): void {
  logBrowserDiag('BrowserSession', fields);
}

export function logBrowserWindow(
  navigationId: number,
  fields: BrowserDiagFields & {
    event?: 'window_open' | 'target_blank' | 'popup';
    handled?: boolean;
    strategy?: 'current_webview' | 'external' | 'unsupported';
  } = {},
): void {
  logBrowserDiag('BrowserWindow', { navigationId, ...fields });
}

export function logBrowserMedia(
  navigationId: number,
  fields: BrowserDiagFields = {},
): void {
  logBrowserDiag('BrowserMedia', { navigationId, ...fields });
}

export function logBrowserWebView(fields: BrowserDiagFields = {}): void {
  logBrowserDiag('BrowserWebView', fields);
}

export function logBrowserHistory(fields: BrowserDiagFields = {}): void {
  logBrowserDiag('BrowserHistory', fields);
}

export function logBrowserDesktop(fields: BrowserDiagFields = {}): void {
  logBrowserDiag('BrowserDesktop', fields);
}

/** @internal Exported for verification scripts. */
export const browserRuntimeDiagnosticsContract = {
  tags: [
    'BrowserNav',
    'BrowserLoad',
    'BrowserError',
    'BrowserSSL',
    'BrowserSession',
    'BrowserWindow',
    'BrowserMedia',
    'BrowserWebView',
    'BrowserHistory',
    'BrowserDesktop',
  ] as const,
  blockedKeys: BLOCKED_KEYS,
};
