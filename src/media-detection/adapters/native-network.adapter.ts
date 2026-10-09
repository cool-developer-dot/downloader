import { Platform } from 'react-native';

import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';
import type { NetworkMediaBatchEvent, WebDownloadEvent } from '@modules/vidorax-web';

import { getV2Engine } from '@/downloads/v2/engine-port';
import { toV2RequestContext } from '@/downloads/v2/enqueue-request';

import { EXTENSION_TO_MIME } from '../constants';
import { logGeneralNetworkTrace } from '../general-media/general-media-diagnostics';
import { recordPipelineOutcome } from '../pipeline/pipeline-outcome';
import { buildMediaRequestContextSync } from '../services/request-context.service';
import { resolveNativeObservationScope } from './native-observation-scope';
import {
  nativeCandidateEventFromObservation,
  nativeCandidateFromWebDownload,
  processNativeMediaCandidateEvent,
  resetNativeNetworkContractForTests,
  type NativeMediaCandidate,
  type NativeMediaCandidateEvent,
} from './native-network.contract';

export type { NativeMediaCandidate, NativeMediaCandidateEvent };
export { processNativeMediaCandidateEvent } from './native-network.contract';

let subscription: { remove: () => void } | null = null;
let downloadSubscription: { remove: () => void } | null = null;
let candidateHandler: ((candidate: NativeMediaCandidate) => void) | null =
  null;

export function setNativeCandidateHandler(
  handler: ((candidate: NativeMediaCandidate) => void) | null,
): void {
  candidateHandler = handler;
}

/**
 * Subscribe to VidoraWeb's passive WebView / ServiceWorker request observations
 * (patched react-native-webview shouldInterceptRequest). Never alters responses.
 */
export function startNativeNetworkObservation(): void {
  if (Platform.OS !== 'android') {
    return;
  }

  stopNativeNetworkObservation();

  const available = isVidoraWebAvailable();
  logGeneralNetworkTrace('OBSERVER_STARTED', {
    modulePresent: available,
    observationSource: 'vidora-web',
  });
  if (!available) {
    return;
  }

  try {
    const web = getVidoraWeb();
    // The first listener makes the native observer start emitting.
    subscription = web.addListener('onNetworkMedia', handleNativeBatch);
    // Listening makes the WebView hand video downloads to detection instead of Android's DownloadManager.
    downloadSubscription = web.addListener('onWebDownload', (event) => {
      void handleWebDownload(event);
    });
    web.setNetworkObservationEnabled(true);
  } catch {
    subscription = null;
    downloadSubscription = null;
  }
}

export function stopNativeNetworkObservation(): void {
  subscription?.remove();
  subscription = null;
  downloadSubscription?.remove();
  downloadSubscription = null;
  if (isVidoraWebAvailable()) {
    try {
      getVidoraWeb().setNetworkObservationEnabled(false);
    } catch {
      // ignore
    }
  }
  resetNativeNetworkContractForTests();
}

function handleNativeBatch(event: NetworkMediaBatchEvent): void {
  for (const observation of event?.observations ?? []) {
    const candidate = processNativeMediaCandidateEvent(
      nativeCandidateEventFromObservation(observation),
    );
    if (candidate && candidateHandler) {
      candidateHandler(candidate);
    }
  }
}

const DISPOSITION_FILE_NAME = /filename\*?\s*=\s*(?:[\w-]+'[\w-]*')?"?([^";]+)"?/i;
const HLS_MIME = 'application/vnd.apple.mpegurl';
const DASH_MIME = 'application/dash+xml';

function extensionOf(name: string | null | undefined): string | null {
  const file = name?.split(/[?#]/)[0]?.split('/').pop() ?? '';
  const dot = file.lastIndexOf('.');
  return dot >= 0 ? file.slice(dot + 1).toLowerCase() : null;
}

/** The video type of a claimed download from its response type or its file name; null when neither says. */
function mimeOfWebDownload(event: WebDownloadEvent): string | null {
  if (event.hint === 'manifest-hls') {
    return HLS_MIME;
  }
  if (event.hint === 'manifest-dash') {
    return DASH_MIME;
  }
  const type = event.mimeType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type.startsWith('video/')) {
    return type;
  }
  const named = extensionOf(DISPOSITION_FILE_NAME.exec(event.contentDisposition ?? '')?.[1]) ?? extensionOf(event.url);
  const mime = named ? EXTENSION_TO_MIME[named] : undefined;
  return mime?.startsWith('video/') ? mime : null;
}

/**
 * A generic binary with no usable name is only a video if the engine's own classifier (which sniffs the first bytes)
 * says so. Anything else — not media, audio, unreachable — is not ours.
 */
async function identifyUnnamedDownload(event: WebDownloadEvent): Promise<string | null> {
  const engine = getV2Engine();
  const scope = resolveNativeObservationScope({
    webViewId: event.viewTag,
    parentViewId: event.viewTag,
    observedAt: Date.now(),
  });
  if (!engine || !scope) {
    return null;
  }
  try {
    const context = buildMediaRequestContextSync({
      mediaUrl: event.url,
      pageUrl: scope.pageUrl,
      userAgent: event.userAgent,
    });
    const result = await engine.probe({ url: event.url, request: toV2RequestContext(context, scope.pageUrl) });
    if (!result.ok) {
      return null;
    }
    if (result.kind === 'hls') {
      return HLS_MIME;
    }
    if (result.kind === 'dash') {
      return DASH_MIME;
    }
    const type = result.contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
    return type.startsWith('video/') ? type : (EXTENSION_TO_MIME[result.container] ?? 'video/mp4');
  } catch {
    return null;
  }
}

async function handOffToSystemDownloader(event: WebDownloadEvent, reason: string): Promise<void> {
  logGeneralNetworkTrace('RESOURCE_REJECTED', {
    rejectionReason: reason,
    acceptedIntoIngest: false,
    observationSource: 'webview-download',
  });
  try {
    await getVidoraWeb().startSystemDownload(event.url, event.userAgent, event.contentDisposition, event.mimeType);
  } catch {
    // The system downloader could not be reached; nothing else can take the file.
  }
}

/**
 * VidoraWeb claimed a download that looks like a video (see `WebDownloadEvent`). It becomes a candidate of the tab
 * that asked for it and goes through the same correlation → verification → offer as every other source, so a pasted
 * DASH manifest or MOV file gets its "Video available" — or an explicit refusal — instead of landing unseen in the
 * phone's Downloads folder. What turns out not to be a video, or has no tab, goes back to the system downloader.
 */
export async function handleWebDownload(event: WebDownloadEvent): Promise<void> {
  const observedAt = Date.now();
  const mimeType = event.hint === 'unknown' ? await identifyUnnamedDownload(event) : mimeOfWebDownload(event);
  if (event.hint === 'unknown' && !mimeType) {
    await handOffToSystemDownloader(event, 'download_not_video');
    return;
  }
  const candidate = nativeCandidateFromWebDownload({ viewTag: event.viewTag, url: event.url, mimeType, observedAt });
  if (!candidate || !candidateHandler) {
    await handOffToSystemDownloader(event, 'download_without_owner');
    return;
  }
  recordPipelineOutcome({
    tabId: candidate.tabId ?? null,
    pageUrl: candidate.pageUrl ?? null,
    mediaUrl: candidate.url,
    stage: 'webview',
    outcome: 'OBSERVED',
    reason: 'USER_REQUESTED_DOWNLOAD',
  });
  candidateHandler(candidate);
}

export function resetNativeNetworkAdapterForTests(): void {
  resetNativeNetworkContractForTests();
  candidateHandler = null;
  subscription = null;
  downloadSubscription = null;
}
