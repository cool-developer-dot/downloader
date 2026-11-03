/**
 * Result of classifying free-form omnibox input before navigation.
 */
export type NavigationInputCategory =
  | 'empty'
  | 'search'
  | 'domain'
  | 'www_domain'
  | 'https_url'
  | 'http_url'
  | 'ip'
  | 'localhost'
  | 'home'
  | 'invalid'
  | 'blocked';

export type NavigationIntent =
  | { kind: 'empty' }
  | { kind: 'home' }
  | {
      kind: 'navigate';
      url: string;
      category: Extract<
        NavigationInputCategory,
        'domain' | 'www_domain' | 'https_url' | 'http_url' | 'ip' | 'localhost'
      >;
    }
  | {
      kind: 'search';
      url: string;
      query: string;
      /** B4 #33: a search shortcut's site (`w Lahore` → "Wikipedia"); absent for the default engine. */
      provider?: string;
    }
  | { kind: 'invalid'; message: string; category: 'invalid' }
  | { kind: 'blocked'; message: string; category: 'blocked' };

export type BrowserSecurityLevel = 'secure' | 'insecure' | 'neutral' | 'warning';

export type BrowserErrorCode =
  | 'invalid_url'
  | 'load_failed'
  | 'network_failure'
  | 'dns_failure'
  | 'connection_interrupted'
  | 'timeout'
  | 'ssl_error'
  /** B12 #124: HTTPS-only opened an http page over https and the site didn't answer securely. */
  | 'https_unavailable'
  /** B12 #124: the same in a build that can't open plain http at all (release): nothing to fall back to. */
  | 'https_required'
  | 'http_error'
  | 'unsupported'
  | 'process_terminated'
  | 'unknown';

export interface BrowserErrorState {
  code: BrowserErrorCode;
  title: string;
  message: string;
  /** Optional safe detail line — never raw Chromium text. */
  safeReason?: string | null;
  /** @deprecated Prefer retryUrl — kept for compatibility. */
  url: string | null;
  /** URL used by Retry — separate from display copy. */
  retryUrl: string | null;
  statusCode?: number;
  /** Canonical failure metadata for diagnostics and stale guards. */
  failure?: import('./browser-failure.types').BrowserFailure;
}
