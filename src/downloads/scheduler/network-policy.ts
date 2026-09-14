/**
 * Network admission + mid-transfer enforcement helpers for the download scheduler.
 *
 * Product rule (Wi-Fi Only ON):
 * - Start only when Wi-Fi is positively confirmed.
 * - Active transfers must pause/hold when Wi-Fi disappears (no cellular bleed).
 */

import type { DownloadNetworkState } from '../network/types';
import {
  pickWaitingReason,
  type QueueWaitingReason,
} from './waiting-reason';

export type NetworkAdmissionDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: Extract<QueueWaitingReason, 'OFFLINE' | 'WAITING_FOR_WIFI'>;
    };

/** Positive Wi-Fi confirmation required when wifiOnly is on. */
export function isPositiveWifi(network: DownloadNetworkState): boolean {
  return network.connected && network.type === 'wifi';
}

export function isClearlyOffline(network: DownloadNetworkState): boolean {
  if (!network.connected || network.type === 'none') {
    return true;
  }
  if (network.internetReachable === false) {
    return true;
  }
  return false;
}

/**
 * Whether a NEW worker may be admitted under current policy + network.
 * Does not mutate status or retryCount.
 */
export function evaluateNetworkAdmission(
  wifiOnly: boolean,
  network: DownloadNetworkState,
): NetworkAdmissionDecision {
  if (isClearlyOffline(network)) {
    return { allowed: false, reason: 'OFFLINE' };
  }

  if (wifiOnly) {
    if (!isPositiveWifi(network)) {
      return { allowed: false, reason: 'WAITING_FOR_WIFI' };
    }
    return { allowed: true };
  }

  // wifiOnly off: any connected usable network (wifi/cellular/ethernet/other/vpn).
  if (network.type === 'unknown') {
    // Connected but unknown type — allow when Wi-Fi Only is OFF (usable link assumed).
    return { allowed: true };
  }

  return { allowed: true };
}

/**
 * True when an already-active transfer must stop transferring bytes
 * under the current Wi-Fi Only / offline policy.
 */
export function shouldHoldActiveTransfer(
  wifiOnly: boolean,
  network: DownloadNetworkState,
): boolean {
  return !evaluateNetworkAdmission(wifiOnly, network).allowed;
}

export function resolvePendingWaitingReason(options: {
  wifiOnly: boolean;
  network: DownloadNetworkState;
  activeCount: number;
  maxConcurrent: number;
  retryDelay?: boolean;
  recoveryPending?: boolean;
}): QueueWaitingReason {
  const candidates: QueueWaitingReason[] = [];

  if (options.retryDelay) {
    candidates.push('RETRY_DELAY');
  }
  if (options.recoveryPending) {
    candidates.push('RECOVERY_PENDING');
  }

  const network = evaluateNetworkAdmission(options.wifiOnly, options.network);
  if (!network.allowed) {
    candidates.push(network.reason);
  }

  if (options.activeCount >= options.maxConcurrent) {
    candidates.push('CAPACITY');
  }

  if (candidates.length === 0) {
    return 'CAPACITY';
  }

  return pickWaitingReason(candidates);
}
