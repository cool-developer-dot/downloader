import type { BrowserErrorCode, BrowserErrorState } from '@/browser/types/navigation.types';
import { classifyBrowserLoadError } from '@/browser/diagnostics';
import {
  createBrowserErrorFromClassification,
  browserFailureContract,
} from '@/browser/services/browser-failure.service';

export { browserFailureContract };

type ErrorCopy = Pick<BrowserErrorState, 'title' | 'message'>;

const ERROR_COPY: Record<BrowserErrorCode, ErrorCopy> = {
  invalid_url: {
    title: 'Unable to open this page',
    message: 'The website could not be loaded.',
  },
  load_failed: {
    title: 'Unable to open this page',
    message: 'The website could not be loaded.',
  },
  network_failure: {
    title: 'Unable to open this page',
    message: 'The website could not be loaded.',
  },
  dns_failure: {
    title: 'Unable to open this page',
    message: 'The website could not be loaded.',
  },
  connection_interrupted: {
    title: 'Unable to open this page',
    message: 'The website could not be loaded.',
  },
  timeout: {
    title: 'Unable to open this page',
    message: 'The website could not be loaded.',
  },
  ssl_error: {
    title: 'Unable to open this page',
    message: 'The website could not be loaded.',
  },
  http_error: {
    title: 'Unable to open this page',
    message: 'The website could not be loaded.',
  },
  unsupported: {
    title: 'Unable to open this page',
    message: 'The website could not be loaded.',
  },
  process_terminated: {
    title: 'Unable to open this page',
    message: 'The website could not be loaded.',
  },
  unknown: {
    title: 'Unable to open this page',
    message: 'The website could not be loaded.',
  },
};

export function createBrowserError(
  code: BrowserErrorCode,
  overrides?: Partial<Omit<BrowserErrorState, 'code'>>,
): BrowserErrorState {
  const copy = ERROR_COPY[code];
  const retryUrl = overrides?.retryUrl ?? overrides?.url ?? null;
  return {
    code,
    title: overrides?.title ?? copy.title,
    message: overrides?.message ?? copy.message,
    safeReason: overrides?.safeReason ?? null,
    url: retryUrl,
    retryUrl,
    statusCode: overrides?.statusCode,
    failure: overrides?.failure,
  };
}

/**
 * Map a WebView load error into a canonical BrowserFailure-backed error state.
 * Raw description is used for classification only — never copied to UI fields.
 */
export function classifyWebViewLoadError(input: {
  description?: string;
  code?: number | string;
  url?: string | null;
  navigationId?: number;
  loadStartUrl?: string | null;
  committedUrl?: string | null;
}): BrowserErrorState {
  const description = input.description ?? '';
  const classification = classifyBrowserLoadError({
    description,
    code: input.code,
  });

  return createBrowserErrorFromClassification({
    navigationId: input.navigationId ?? 0,
    classification,
    source: classification === 'ssl' ? 'webview_ssl' : 'webview_error',
    failingUrl: input.url ?? null,
    loadStartUrl: input.loadStartUrl,
    committedUrl: input.committedUrl,
    errorCode: input.code,
    mainFrame: true,
  });
}
