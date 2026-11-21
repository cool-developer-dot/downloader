/**
 * P6 Remote control screen: what it shows for a status. Pure, tested under Node.
 */

import type { RemoteStatus, RemoteStopReason } from '@modules/vidorax-media/src/VidoraRemote.types';

import type { TranslationKey } from '@/localization/types';

export const REMOTE_OFF: RemoteStatus = {
  running: false,
  url: null,
  address: null,
  port: null,
  pin: null,
  lockedUntil: null,
  pinWithdrawn: false,
  stopReason: null,
  idleStopsAt: null,
  clients: [],
};

/** "123 456": easier to read across a room and to type. */
export function formatPin(pin: string | null): string {
  return pin && /^\d{6}$/.test(pin) ? `${pin.slice(0, 3)} ${pin.slice(3)}` : '';
}

/**
 * What the QR code holds: the address, with the PIN after `#` so a phone or tablet that scans it pairs in one step.
 * The part after `#` never reaches the server or any log.
 */
export function remoteQrText(status: RemoteStatus): string | null {
  if (!status.running || !status.url) return null;
  return status.pin ? `${status.url}/#pin=${status.pin}` : `${status.url}/`;
}

const STOP_REASON_KEYS: Record<RemoteStopReason, TranslationKey | null> = {
  user: null,
  idle: 'remoteControl.stoppedIdle',
  wifi_lost: 'remoteControl.stoppedWifi',
  background: 'remoteControl.stoppedBackground',
  error: 'remoteControl.stoppedError',
};

/** Why it is off now, when it stopped by itself; null when the user turned it off or it never ran. */
export function stopReasonKey(status: RemoteStatus): TranslationKey | null {
  if (status.running || !status.stopReason) return null;
  return STOP_REASON_KEYS[status.stopReason] ?? null;
}

/** Seconds left of a PIN lock, or 0. */
export function lockSecondsLeft(status: RemoteStatus, now: number): number {
  if (!status.running || !status.lockedUntil) return 0;
  return Math.max(0, Math.ceil((status.lockedUntil - now) / 1000));
}

/** The error code of a failed start, as the message to show. */
export function startErrorKey(code: string | undefined): TranslationKey {
  return code === 'ERR_NO_WIFI' ? 'remoteControl.needsWifi' : 'remoteControl.startFailed';
}
