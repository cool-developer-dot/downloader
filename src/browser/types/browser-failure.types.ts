import type { BrowserErrorClassification } from '@/browser/diagnostics';

/**
 * Canonical browser failure categories — never expose raw Chromium codes to UI.
 */
export type BrowserFailureCategory =
  | 'OFFLINE'
  | 'DNS'
  | 'CONNECTION_ABORTED'
  | 'CONNECTION_RESET'
  | 'TIMEOUT'
  | 'SSL'
  | 'HTTP'
  | 'RENDER_PROCESS'
  | 'MALFORMED_URL'
  | 'UNSUPPORTED_SCHEME'
  | 'UNKNOWN';

export type BrowserFailureSource =
  | 'webview_error'
  | 'webview_http'
  | 'webview_ssl'
  | 'render_process'
  | 'navigation';

/**
 * Canonical main-frame browser failure record.
 * Raw technical codes remain internal — safeReason/title/message feed UI only.
 */
export interface BrowserFailure {
  id: string;
  navigationId: number;
  category: BrowserFailureCategory;
  source: BrowserFailureSource;
  recoverable: boolean;
  /** Optional user-facing detail line — never a raw net::ERR string. */
  safeReason: string | null;
  /** URL to reload on Retry — may include signed query params; not for display. */
  retryUrl: string | null;
  occurredAt: number;
  /** Internal diagnostics only. */
  errorCode?: number | string;
  mainFrame: boolean;
  statusCode?: number;
  userInitiatedAbort?: boolean;
  renderRecoveryAttempt?: number;
  staleDropped?: boolean;
}

export function classificationToCategory(
  classification: BrowserErrorClassification,
): BrowserFailureCategory {
  switch (classification) {
    case 'offline':
      return 'OFFLINE';
    case 'dns':
      return 'DNS';
    case 'aborted':
      return 'CONNECTION_ABORTED';
    case 'reset':
      return 'CONNECTION_RESET';
    case 'timeout':
      return 'TIMEOUT';
    case 'ssl':
      return 'SSL';
    case 'http':
      return 'HTTP';
    case 'render_process':
      return 'RENDER_PROCESS';
    case 'malformed_url':
      return 'MALFORMED_URL';
    default:
      return 'UNKNOWN';
  }
}
