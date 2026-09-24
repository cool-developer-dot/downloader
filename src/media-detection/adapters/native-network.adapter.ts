import { Platform } from 'react-native';

import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';
import type { NetworkMediaBatchEvent } from '@modules/vidorax-web';

import { logGeneralNetworkTrace } from '../general-media/general-media-diagnostics';
import {
  nativeCandidateEventFromObservation,
  processNativeMediaCandidateEvent,
  resetNativeNetworkContractForTests,
  type NativeMediaCandidate,
  type NativeMediaCandidateEvent,
} from './native-network.contract';

export type { NativeMediaCandidate, NativeMediaCandidateEvent };
export { processNativeMediaCandidateEvent } from './native-network.contract';

let subscription: { remove: () => void } | null = null;
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
    web.setNetworkObservationEnabled(true);
  } catch {
    subscription = null;
  }
}

export function stopNativeNetworkObservation(): void {
  subscription?.remove();
  subscription = null;
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

export function resetNativeNetworkAdapterForTests(): void {
  resetNativeNetworkContractForTests();
  candidateHandler = null;
  subscription = null;
}
