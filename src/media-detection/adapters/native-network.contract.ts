import { DETECTION_TIMING } from '../constants';
import {
  classifyGeneralNetworkResource,
  classifyHostRelation,
  resourceFingerprintFromUrl,
} from '../general-media/general-network-resource';
import { canonicalizeObservedMediaUrl } from '../general-media/playback-media-evidence';
import { logGeneralNetworkTrace } from '../general-media/general-media-diagnostics';
import { extractHostname, isSafeMediaUrl, normalizeMediaUrl } from '../utils';
import { resolveNativeObservationScope } from './native-observation-scope';

export type NativeMediaCandidate = {
  tabId?: string;
  navigationEpoch?: number;
  observedAt?: number;
  frameUrl?: string | null;
  url: string;
  mimeType: string | null;
  requiresCookies: boolean;
  pageUrl?: string;
  hasRange?: boolean;
  isForMainFrame?: boolean;
  resourceFingerprint?: string | null;
  observationSource?: string | null;
};

export type NativeMediaCandidateEvent = {
  webViewId?: number;
  parentViewId?: number;
  observedAt?: number;
  requestReferer?: string | null;
  url?: string;
  method?: string;
  mimeHint?: string | null;
  isForMainFrame?: boolean;
  hasRange?: boolean;
  hasCookieHeader?: boolean;
  pageUrl?: string | null;
  resourceFingerprint?: string | null;
  observationSource?: string | null;
  Cookie?: unknown;
  Authorization?: unknown;
  cookie?: unknown;
  authorization?: unknown;
};

export type NativeMediaTraceEvent = {
  stage?: string;
  event?: string;
  reason?: string | null;
  observationSource?: string | null;
  method?: string | null;
  isForMainFrame?: boolean;
  hasRange?: boolean;
  acceptClass?: string | null;
  hostClass?: string | null;
  pathClass?: string | null;
  resourceTypeHint?: string | null;
  resourceFingerprint?: string | null;
  url?: unknown;
  pageUrl?: unknown;
  Cookie?: unknown;
  Authorization?: unknown;
};

const FORBIDDEN_NATIVE_KEYS = [
  'cookie',
  'authorization',
  'set-cookie',
  'token',
  'query',
  'signedurl',
];

let lastKeys = new Map<string, number>();

export function nativeTracePayloadIsSanitized(
  payload: Record<string, unknown> | null | undefined,
): boolean {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  for (const key of Object.keys(payload)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_NATIVE_KEYS.includes(lower)) {
      return false;
    }
  }
  const url = payload.url;
  if (typeof url === 'string' && /https?:\/\//i.test(url)) {
    return false;
  }
  const pageUrl = payload.pageUrl;
  if (typeof pageUrl === 'string' && /https?:\/\//i.test(pageUrl)) {
    return false;
  }
  const blob = JSON.stringify(payload).toLowerCase();
  if (blob.includes('cookie=') || blob.includes('authorization') || blob.includes('bearer ')) {
    return false;
  }
  return true;
}

export function processNativeMediaCandidateEvent(
  event: NativeMediaCandidateEvent,
): NativeMediaCandidate | null {
  const fingerprint =
    typeof event.resourceFingerprint === 'string' && event.resourceFingerprint.length > 0
      ? event.resourceFingerprint
      : resourceFingerprintFromUrl(typeof event.url === 'string' ? event.url : '');

  logGeneralNetworkTrace('JS_RECEIVED', {
    candidateFingerprintHash: fingerprint,
    frameClass: event.isForMainFrame === false ? 'child-frame' : 'main',
    hasRange: Boolean(event.hasRange),
    observationSource: event.observationSource ?? 'webview',
    method: typeof event.method === 'string' ? event.method.slice(0, 16) : null,
  });

  if (event.Cookie != null || event.cookie != null || event.Authorization != null || event.authorization != null) {
    logGeneralNetworkTrace('RESOURCE_REJECTED', {
      candidateFingerprintHash: fingerprint,
      rejectionReason: 'secret_header_stripped',
      acceptedIntoIngest: false,
    });
  }

  const urlRaw = typeof event.url === 'string' ? event.url : '';
  if (!urlRaw || !isSafeMediaUrl(urlRaw)) {
    logGeneralNetworkTrace('RESOURCE_REJECTED', {
      candidateFingerprintHash: fingerprint,
      rejectionReason: 'unsafe_or_missing_url',
      acceptedIntoIngest: false,
      frameClass: event.isForMainFrame === false ? 'child-frame' : 'main',
    });
    return null;
  }

  const url = normalizeMediaUrl(canonicalizeObservedMediaUrl(urlRaw));
  if (!url) {
    logGeneralNetworkTrace('RESOURCE_REJECTED', {
      candidateFingerprintHash: fingerprint,
      rejectionReason: 'url_normalize_failed',
      acceptedIntoIngest: false,
    });
    return null;
  }

  const scope = resolveNativeObservationScope(event);
  const now = Date.now();
  const dedupeKey = `${scope?.tabId ?? event.parentViewId ?? event.webViewId ?? 'unowned'}|${scope?.navigationEpoch ?? ''}|${url}`;
  const prev = lastKeys.get(dedupeKey);
  if (prev != null && now - prev < DETECTION_TIMING.nativeEventDedupeMs) {
    return null;
  }
  lastKeys.set(dedupeKey, now);

  if (lastKeys.size > 300) {
    const first = lastKeys.keys().next().value;
    if (first) {
      lastKeys.delete(first);
    }
  }

  const mimeHint =
    typeof event.mimeHint === 'string' && event.mimeHint.length > 0
      ? event.mimeHint.slice(0, 128)
      : null;
  const hasRange = Boolean(event.hasRange);
  const isForMainFrame = Boolean(event.isForMainFrame);
  const pageUrl = scope?.pageUrl ?? (typeof event.pageUrl === 'string' ? event.pageUrl : undefined);
  const classified = classifyGeneralNetworkResource({
    url,
    mimeType: mimeHint,
    hasRange,
    isForMainFrame,
  });
  const pageHost = pageUrl ? extractHostname(pageUrl) : null;
  const requestHost = extractHostname(url);
  const acceptedIntoIngest = classified.acceptForIngest || classified.acceptForProbe;

  logGeneralNetworkTrace('RESOURCE_CLASSIFIED', {
    candidateFingerprintHash: fingerprint,
    frameClass: isForMainFrame ? 'main' : 'child-frame',
    mainPageHostClass: pageHost ? 'page-host' : 'unknown',
    requestHostClass: requestHost
      ? classifyHostRelation(pageHost ?? '', requestHost)
      : 'unknown',
    requestPathShape: classified.pathShape,
    initiatorClass: isForMainFrame ? 'main-frame' : 'iframe',
    hasRange,
    mimeHintClass: classified.mimeHintClass,
    candidateFamily: classified.candidateFamily,
    acceptedIntoIngest,
    rejectionReason: classified.rejectionReason,
    observationSource: event.observationSource ?? 'webview',
  });

  if (!acceptedIntoIngest) {
    logGeneralNetworkTrace('RESOURCE_REJECTED', {
      candidateFingerprintHash: fingerprint,
      rejectionReason: classified.rejectionReason ?? 'non_media',
      acceptedIntoIngest: false,
      frameClass: isForMainFrame ? 'main' : 'child-frame',
      hasRange,
      observationSource: event.observationSource ?? 'webview',
    });
    return null;
  }

  logGeneralNetworkTrace('RESOURCE_OBSERVED', {
    candidateFingerprintHash: fingerprint,
    frameClass: isForMainFrame ? 'main' : 'child-frame',
    mainPageHostClass: pageHost ? 'page-host' : 'unknown',
    requestHostClass: requestHost
      ? classifyHostRelation(pageHost ?? '', requestHost)
      : 'unknown',
    requestPathShape: classified.pathShape,
    initiatorClass: isForMainFrame ? 'main-frame' : 'iframe',
    hasRange,
    mimeHintClass: classified.mimeHintClass,
    candidateFamily: classified.candidateFamily,
    acceptedIntoIngest: true,
    rejectionReason: classified.rejectionReason,
    observationSource: event.observationSource ?? 'webview',
  });

  return {
    url,
    tabId: scope?.tabId,
    navigationEpoch: scope?.navigationEpoch,
    observedAt: event.observedAt,
    frameUrl: typeof event.requestReferer === 'string' && isSafeMediaUrl(event.requestReferer) ? event.requestReferer : null,
    mimeType: mimeHint,
    requiresCookies: Boolean(event.hasCookieHeader),
    pageUrl,
    hasRange,
    isForMainFrame,
    resourceFingerprint: fingerprint,
    observationSource: event.observationSource ?? 'webview',
  };
}

export function applyNativeMediaTraceEvent(event: NativeMediaTraceEvent): boolean {
  const payload = event as unknown as Record<string, unknown>;
  if (!nativeTracePayloadIsSanitized(payload)) {
    logGeneralNetworkTrace('RESOURCE_REJECTED', {
      rejectionReason: 'trace_payload_not_sanitized',
      candidateFingerprintHash:
        typeof event.resourceFingerprint === 'string' ? event.resourceFingerprint : null,
    });
    return false;
  }
  const stage =
    event.stage === 'RESOURCE_SEEN' ||
    event.stage === 'NATIVE_EMITTED' ||
    event.stage === 'RESOURCE_REJECTED' ||
    event.stage === 'RESOURCE_PREFILTER_CLASSIFIED' ||
    event.stage === 'RESOURCE_PREFILTERED'
      ? event.stage === 'RESOURCE_PREFILTERED'
        ? 'RESOURCE_PREFILTER_CLASSIFIED'
        : event.stage
      : event.event === 'RESOURCE_SEEN'
        ? 'RESOURCE_SEEN'
        : 'RESOURCE_CLASSIFIED';
  logGeneralNetworkTrace(stage, {
    candidateFingerprintHash:
      typeof event.resourceFingerprint === 'string' ? event.resourceFingerprint : null,
    reason: event.reason ?? null,
    rejectionReason: event.reason ?? null,
    observationSource: event.observationSource ?? null,
    method: typeof event.method === 'string' ? event.method : null,
    frameClass: event.isForMainFrame === false ? 'child-frame' : 'main',
    hasRange: Boolean(event.hasRange),
    acceptClass: event.acceptClass ?? null,
    pathClass: event.pathClass ?? null,
    resourceTypeHint: event.resourceTypeHint ?? null,
    requestHostClass: event.hostClass ?? null,
  });
  return true;
}

export function resetNativeNetworkContractForTests(): void {
  lastKeys.clear();
}
