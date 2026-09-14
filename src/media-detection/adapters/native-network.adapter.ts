import { DeviceEventEmitter, NativeEventEmitter, NativeModules, Platform } from 'react-native';

import { logGeneralNetworkTrace } from '../general-media/general-media-diagnostics';
import {
  applyNativeMediaTraceEvent,
  processNativeMediaCandidateEvent,
  resetNativeNetworkContractForTests,
  type NativeMediaCandidate,
  type NativeMediaCandidateEvent,
  type NativeMediaTraceEvent,
} from './native-network.contract';

export type { NativeMediaCandidate, NativeMediaCandidateEvent, NativeMediaTraceEvent };
export {
  nativeTracePayloadIsSanitized,
  processNativeMediaCandidateEvent,
} from './native-network.contract';

type MediaNetworkModuleShape = {
  setEnabled?: (enabled: boolean) => void;
};

const MODULE_NAME = 'VidoraMediaNetworkObserver';
const CANDIDATE_EVENT = 'VidoraMediaNetworkCandidate';
const TRACE_EVENT = 'VidoraMediaNetworkTrace';

let subscriptions: Array<{ remove: () => void }> = [];
let candidateHandler: ((candidate: NativeMediaCandidate) => void) | null =
  null;

export function setNativeCandidateHandler(
  handler: ((candidate: NativeMediaCandidate) => void) | null,
): void {
  candidateHandler = handler;
}

function getNativeModule(): MediaNetworkModuleShape | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  const mod = NativeModules[MODULE_NAME] as MediaNetworkModuleShape | undefined;
  return mod ?? null;
}

/**
 * Subscribe to Android WebView shouldInterceptRequest observations.
 * Passive-only, non-blocking — never alters response bodies.
 */
export function startNativeNetworkObservation(): void {
  if (Platform.OS !== 'android') {
    return;
  }

  stopNativeNetworkObservation();

  const mod = getNativeModule();
  logGeneralNetworkTrace('OBSERVER_STARTED', {
    modulePresent: Boolean(mod),
    observationSource: 'js-adapter',
  });

  try {
    mod?.setEnabled?.(true);
  } catch {
    // Module optional until native linked — DeviceEventEmitter still listens.
  }

  const onCandidate = (event: NativeMediaCandidateEvent) => {
    handleNativeCandidate(event);
  };
  const onTrace = (event: NativeMediaTraceEvent) => {
    applyNativeMediaTraceEvent(event);
  };

  let attached = false;
  try {
    subscriptions.push(DeviceEventEmitter.addListener(CANDIDATE_EVENT, onCandidate));
    subscriptions.push(DeviceEventEmitter.addListener(TRACE_EVENT, onTrace));
    attached = true;
  } catch {
    // DeviceEventEmitter may be unavailable in some test hosts.
  }

  if (!attached && mod) {
    try {
      const emitter = new NativeEventEmitter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mod as any,
      );
      subscriptions.push(emitter.addListener(CANDIDATE_EVENT, onCandidate));
      subscriptions.push(emitter.addListener(TRACE_EVENT, onTrace));
    } catch {
      // Native emitter unavailable — observation still enabled for a later attach.
    }
  }
}

export function stopNativeNetworkObservation(): void {
  try {
    getNativeModule()?.setEnabled?.(false);
  } catch {
    // ignore
  }
  for (const sub of subscriptions) {
    try {
      sub.remove();
    } catch {
      // ignore
    }
  }
  subscriptions = [];
  resetNativeNetworkContractForTests();
}

function handleNativeCandidate(event: NativeMediaCandidateEvent): void {
  const candidate = processNativeMediaCandidateEvent(event);
  if (!candidate || !candidateHandler) {
    return;
  }
  candidateHandler(candidate);
}

export function resetNativeNetworkAdapterForTests(): void {
  resetNativeNetworkContractForTests();
  candidateHandler = null;
  subscriptions = [];
}
