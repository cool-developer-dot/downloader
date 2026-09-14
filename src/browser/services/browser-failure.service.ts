import type { BrowserErrorClassification } from '@/browser/diagnostics/browser-runtime-diagnostics.service';
import type { BrowserErrorCode, BrowserErrorState } from '@/browser/types/navigation.types';
import type {
  BrowserFailure,
  BrowserFailureCategory,
  BrowserFailureSource,
} from '@/browser/types/browser-failure.types';
import { classificationToCategory } from '@/browser/types/browser-failure.types';

type FailureCopy = Pick<BrowserErrorState, 'title' | 'message'>;

function isRetryableUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Resolve retry URL — failing URL first, then load-start URL, then committed URL. */
export function resolveBrowserRetryUrl(input: {
  failingUrl?: string | null;
  loadStartUrl?: string | null;
  committedUrl?: string | null;
}): string | null {
  for (const candidate of [input.failingUrl, input.loadStartUrl, input.committedUrl]) {
    if (candidate && isRetryableUrl(candidate)) {
      return candidate;
    }
  }
  return null;
}

const CATEGORY_COPY: Record<BrowserFailureCategory, FailureCopy & { safeReason: string | null }> =
  {
    OFFLINE: {
      title: 'Unable to open this page',
      message: 'The website could not be loaded.',
      safeReason: 'No internet connection',
    },
    DNS: {
      title: 'Unable to open this page',
      message: 'The website could not be loaded.',
      safeReason: 'The website address could not be reached.',
    },
    CONNECTION_ABORTED: {
      title: 'Unable to open this page',
      message: 'The website could not be loaded.',
      safeReason: 'Connection interrupted',
    },
    CONNECTION_RESET: {
      title: 'Unable to open this page',
      message: 'The website could not be loaded.',
      safeReason: 'Connection interrupted',
    },
    TIMEOUT: {
      title: 'Unable to open this page',
      message: 'The website could not be loaded.',
      safeReason: 'Page took too long to respond',
    },
    SSL: {
      title: 'Unable to open this page',
      message: 'The website could not be loaded.',
      safeReason: 'Secure connection failed',
    },
    HTTP: {
      title: 'Unable to open this page',
      message: 'The website could not be loaded.',
      safeReason: 'Website unavailable',
    },
    RENDER_PROCESS: {
      title: 'Unable to open this page',
      message: 'The website could not be loaded.',
      safeReason: null,
    },
    MALFORMED_URL: {
      title: 'Unable to open this page',
      message: 'The website could not be loaded.',
      safeReason: null,
    },
    UNSUPPORTED_SCHEME: {
      title: 'Unable to open this page',
      message: 'The website could not be loaded.',
      safeReason: null,
    },
    UNKNOWN: {
      title: 'Unable to open this page',
      message: 'The website could not be loaded.',
      safeReason: null,
    },
  };

const CATEGORY_TO_CODE: Record<BrowserFailureCategory, BrowserErrorCode> = {
  OFFLINE: 'network_failure',
  DNS: 'dns_failure',
  CONNECTION_ABORTED: 'connection_interrupted',
  CONNECTION_RESET: 'connection_interrupted',
  TIMEOUT: 'timeout',
  SSL: 'ssl_error',
  HTTP: 'http_error',
  RENDER_PROCESS: 'process_terminated',
  MALFORMED_URL: 'invalid_url',
  UNSUPPORTED_SCHEME: 'unsupported',
  UNKNOWN: 'unknown',
};

let failureSequence = 0;

function nextFailureId(): string {
  failureSequence += 1;
  return `bf_${failureSequence}_${Date.now()}`;
}

export function createBrowserFailure(input: {
  navigationId: number;
  classification: BrowserErrorClassification;
  source: BrowserFailureSource;
  retryUrl?: string | null;
  errorCode?: number | string;
  mainFrame?: boolean;
  statusCode?: number;
  userInitiatedAbort?: boolean;
  renderRecoveryAttempt?: number;
  categoryOverride?: BrowserFailureCategory;
}): BrowserFailure {
  const category = input.categoryOverride ?? classificationToCategory(input.classification);
  const copy = CATEGORY_COPY[category];

  return {
    id: nextFailureId(),
    navigationId: input.navigationId,
    category,
    source: input.source,
    recoverable: category !== 'UNSUPPORTED_SCHEME',
    safeReason: copy.safeReason,
    retryUrl: input.retryUrl ?? null,
    occurredAt: Date.now(),
    errorCode: input.errorCode,
    mainFrame: input.mainFrame ?? true,
    statusCode: input.statusCode,
    userInitiatedAbort: input.userInitiatedAbort,
    renderRecoveryAttempt: input.renderRecoveryAttempt,
  };
}

export function browserFailureToErrorState(failure: BrowserFailure): BrowserErrorState {
  const copy = CATEGORY_COPY[failure.category];
  const code = CATEGORY_TO_CODE[failure.category];

  return {
    code,
    title: copy.title,
    message: copy.message,
    safeReason: failure.safeReason,
    url: failure.retryUrl,
    retryUrl: failure.retryUrl,
    statusCode: failure.statusCode,
    failure,
  };
}

export function createBrowserErrorFromClassification(input: {
  navigationId: number;
  classification: BrowserErrorClassification;
  source: BrowserFailureSource;
  failingUrl?: string | null;
  loadStartUrl?: string | null;
  committedUrl?: string | null;
  errorCode?: number | string;
  mainFrame?: boolean;
  statusCode?: number;
  userInitiatedAbort?: boolean;
  renderRecoveryAttempt?: number;
  categoryOverride?: BrowserFailureCategory;
}): BrowserErrorState {
  const retryUrl = resolveBrowserRetryUrl({
    failingUrl: input.failingUrl,
    loadStartUrl: input.loadStartUrl,
    committedUrl: input.committedUrl,
  });

  const failure = createBrowserFailure({
    navigationId: input.navigationId,
    classification: input.classification,
    source: input.source,
    retryUrl,
    errorCode: input.errorCode,
    mainFrame: input.mainFrame,
    statusCode: input.statusCode,
    userInitiatedAbort: input.userInitiatedAbort,
    renderRecoveryAttempt: input.renderRecoveryAttempt,
    categoryOverride: input.categoryOverride,
  });

  return browserFailureToErrorState(failure);
}

/** @internal Exported for verification scripts. */
export const browserFailureContract = {
  categories: Object.keys(CATEGORY_COPY) as BrowserFailureCategory[],
  neverExposePatterns: ['net::ERR_', 'Domain: undefined', 'ERR_NAME_NOT_RESOLVED'],
};
