import type { NetworkMediaObservation } from '@modules/vidorax-web/src/VidoraWeb.types';

import { DETECTION_TIMING } from '../constants';
import {
  classifyGeneralNetworkResource,
  classifyHostRelation,
  resourceFingerprintFromUrl,
} from '../general-media/general-network-resource';
import { canonicalizeObservedMediaUrl } from '../general-media/playback-media-evidence';
import {
  logGeneralNetworkTrace,
  requestFrameClass,
  requestInitiatorClass,
} from '../general-media/general-media-diagnostics';
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

let lastKeys = new Map<string, number>();

const MEDIA_ACCEPT_TOKEN = /video\/|audio\/|mpegurl|dash\+xml/i;

/** First media MIME token of a request Accept header — request metadata, never a response Content-Type. */
function firstMediaAcceptToken(accept: string | null | undefined): string | null {
  const token = accept?.split(',')[0]?.split(';')[0]?.trim().slice(0, 128);
  return token && MEDIA_ACCEPT_TOKEN.test(token) ? token : null;
}

/**
 * VidoraWeb (modules/vidorax-web) owns the WebView and ServiceWorker request hooks. Its batched
 * `onNetworkMedia` observations enter the active detector here, in the event shape the
 * scope/classification pipeline below consumes. Service worker requests carry viewTag -1.
 */
export function nativeCandidateEventFromObservation(
  observation: NetworkMediaObservation,
): NativeMediaCandidateEvent {
  const fromServiceWorker = observation.viewTag < 0;
  return {
    webViewId: observation.viewTag,
    parentViewId: observation.viewTag,
    observedAt: observation.observedAt,
    requestReferer: observation.referer,
    url: observation.url,
    method: observation.method,
    mimeHint: firstMediaAcceptToken(observation.accept),
    isForMainFrame: observation.isMainFrame,
    hasRange: observation.hasRange || observation.rangeStart != null,
    hasCookieHeader: false,
    pageUrl: null,
    resourceFingerprint: null,
    observationSource: fromServiceWorker ? 'service-worker' : 'webview',
  };
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
    frameClass: requestFrameClass(event.isForMainFrame),
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
      frameClass: requestFrameClass(event.isForMainFrame),
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
  const initiatorClass = requestInitiatorClass(
    typeof event.requestReferer === 'string' ? event.requestReferer : null,
    pageUrl,
  );

  logGeneralNetworkTrace('RESOURCE_CLASSIFIED', {
    candidateFingerprintHash: fingerprint,
    frameClass: requestFrameClass(isForMainFrame),
    mainPageHostClass: pageHost ? 'page-host' : 'unknown',
    requestHostClass: requestHost
      ? classifyHostRelation(pageHost ?? '', requestHost)
      : 'unknown',
    requestPathShape: classified.pathShape,
    initiatorClass,
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
      frameClass: requestFrameClass(isForMainFrame),
      hasRange,
      observationSource: event.observationSource ?? 'webview',
    });
    return null;
  }

  logGeneralNetworkTrace('RESOURCE_OBSERVED', {
    candidateFingerprintHash: fingerprint,
    frameClass: requestFrameClass(isForMainFrame),
    mainPageHostClass: pageHost ? 'page-host' : 'unknown',
    requestHostClass: requestHost
      ? classifyHostRelation(pageHost ?? '', requestHost)
      : 'unknown',
    requestPathShape: classified.pathShape,
    initiatorClass,
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

export function resetNativeNetworkContractForTests(): void {
  lastKeys.clear();
}
