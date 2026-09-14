/**
 * Singleton network monitor for the download scheduler.
 * One listener ownership — not per-download.
 * Supports deterministic overrides for code-level tests (no real NetInfo).
 */

import type {
  DownloadNetworkListener,
  DownloadNetworkState,
  DownloadNetworkType,
} from './types';
import { DEFAULT_DOWNLOAD_NETWORK_STATE } from './types';
import { logNetworkPolicy } from '../engine/audit-diagnostics.service';
import { getDownloadSettings } from '../settings/policy';

let current: DownloadNetworkState = { ...DEFAULT_DOWNLOAD_NETWORK_STATE };
let overrideState: DownloadNetworkState | null = null;
const listeners = new Set<DownloadNetworkListener>();
let unsubscribeNative: (() => void) | null = null;
let started = false;

function mapNetInfoType(raw: string | null | undefined): DownloadNetworkType {
  switch (raw) {
    case 'wifi':
      return 'wifi';
    case 'cellular':
      return 'cellular';
    case 'ethernet':
      return 'ethernet';
    case 'vpn':
      return 'vpn';
    case 'none':
      return 'none';
    case 'unknown':
      return 'unknown';
    case 'bluetooth':
    case 'wimax':
    case 'other':
      return 'other';
    default:
      return 'unknown';
  }
}

function publish(next: DownloadNetworkState): void {
  const effective = overrideState ?? next;
  const changed =
    effective.connected !== current.connected ||
    effective.internetReachable !== current.internetReachable ||
    effective.type !== current.type;
  current = { ...effective };
  if (!changed) {
    return;
  }
  const settings = getDownloadSettings();
  logNetworkPolicy({
    network: current.type,
    isConnected: current.connected,
    wifiOnly: settings.wifiOnly,
  });
  for (const listener of listeners) {
    try {
      listener({ ...current });
    } catch {
      // ignore
    }
  }
}

export function getDownloadNetworkState(): DownloadNetworkState {
  return { ...(overrideState ?? current) };
}

export function subscribeDownloadNetwork(
  listener: DownloadNetworkListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test / verifier only — forces network truth without native NetInfo. */
export function setDownloadNetworkStateOverride(
  state: DownloadNetworkState | null,
): void {
  overrideState = state ? { ...state } : null;
  publish(current);
}

export async function startDownloadNetworkMonitor(): Promise<void> {
  if (started) {
    return;
  }
  started = true;

  try {
    const NetInfo = await import('@react-native-community/netinfo');
    const initial = await NetInfo.default.fetch();
    publish({
      connected: initial.isConnected === true,
      internetReachable:
        initial.isInternetReachable === null ||
        initial.isInternetReachable === undefined
          ? null
          : Boolean(initial.isInternetReachable),
      type: mapNetInfoType(initial.type),
    });

    unsubscribeNative = NetInfo.default.addEventListener((state) => {
      publish({
        connected: state.isConnected === true,
        internetReachable:
          state.isInternetReachable === null ||
          state.isInternetReachable === undefined
            ? null
            : Boolean(state.isInternetReachable),
        type: mapNetInfoType(state.type),
      });
    });
  } catch {
    // Native module unavailable (Node verifier / web) — keep defaults.
    publish({ ...DEFAULT_DOWNLOAD_NETWORK_STATE });
  }
}

export function stopDownloadNetworkMonitor(): void {
  if (unsubscribeNative) {
    unsubscribeNative();
    unsubscribeNative = null;
  }
  started = false;
}

export function resetDownloadNetworkMonitorForTests(): void {
  stopDownloadNetworkMonitor();
  overrideState = null;
  current = { ...DEFAULT_DOWNLOAD_NETWORK_STATE };
  listeners.clear();
}
