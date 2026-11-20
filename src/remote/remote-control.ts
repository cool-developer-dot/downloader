/**
 * P6 Remote control (#439, #438), Send to computer (#511) and the Automation API switch (#499) on the JavaScript
 * side: the native `VidoraRemote` module, a store of its status for the screen, and the bridge that hands links from
 * outside the app to Batch Add. Nothing here talks to any server of ours — the phone itself is the server, on the
 * local network only.
 */

import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { getVidoraRemote } from '@modules/vidorax-media/src/VidoraRemoteModule';
import type { RemoteStatus, SentToComputerItem } from '@modules/vidorax-media/src/VidoraRemote.types';

import { translate } from '@/localization';
import { createStore } from '@/store/shared/create-store';

import { createLinkIntakeQueue } from './link-intake-queue';
import { REMOTE_OFF } from './remote-presentation';

type RemoteState = {
  status: RemoteStatus;
  allowOtherApps: boolean;
  sent: SentToComputerItem[];
};

export const useRemoteStore = createStore<RemoteState>(() => ({
  status: REMOTE_OFF,
  allowOtherApps: false,
  sent: [],
}));

export function isRemoteControlAvailable(): boolean {
  return getVidoraRemote() != null;
}

function setStatus(status: RemoteStatus | null | undefined): RemoteStatus {
  const next = status ?? REMOTE_OFF;
  useRemoteStore.setState({ status: next });
  return next;
}

export async function refreshRemoteState(): Promise<void> {
  const native = getVidoraRemote();
  if (!native) return;
  const [status, allowOtherApps, sent] = await Promise.all([
    native.getRemoteStatus(),
    native.getAllowOtherApps(),
    native.listSentToComputer(),
  ]);
  useRemoteStore.setState({ status, allowOtherApps, sent });
}

/** Rejects with the native error (`code` ERR_NO_WIFI / ERR_REMOTE_START). */
export async function startRemoteControl(): Promise<RemoteStatus> {
  const native = getVidoraRemote();
  if (!native) return setStatus(REMOTE_OFF);
  return setStatus(await native.startRemoteControl());
}

export async function stopRemoteControl(): Promise<RemoteStatus> {
  const native = getVidoraRemote();
  if (!native) return setStatus(REMOTE_OFF);
  return setStatus(await native.stopRemoteControl());
}

export async function newRemotePin(): Promise<void> {
  const native = getVidoraRemote();
  if (native) setStatus(await native.newRemotePin());
}

export async function forgetRemoteClient(id: string): Promise<void> {
  const native = getVidoraRemote();
  if (native) setStatus(await native.forgetRemoteClient(id));
}

export async function forgetAllRemoteClients(): Promise<void> {
  const native = getVidoraRemote();
  if (native) setStatus(await native.forgetAllRemoteClients());
}

export async function setAllowOtherApps(allowed: boolean): Promise<void> {
  const native = getVidoraRemote();
  if (!native) return;
  useRemoteStore.setState({ allowOtherApps: allowed });
  await native.setAllowOtherApps(allowed);
}

export async function removeSentToComputer(id: string): Promise<void> {
  const native = getVidoraRemote();
  if (!native) return;
  await native.removeSentToComputer(id);
  useRemoteStore.setState({ sent: await native.listSentToComputer() });
}

export async function clearSentToComputer(): Promise<void> {
  const native = getVidoraRemote();
  if (!native) return;
  await native.clearSentToComputer();
  useRemoteStore.setState({ sent: [] });
}

function announce(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

/**
 * #511 "Send to computer": a link — and, for a finished download, its video — goes to the Web UI's "Sent from phone"
 * list, where the computer opens or downloads it with its own browser.
 */
export async function sendToComputer(input: { url: string | null; title: string; downloadId?: string | null }): Promise<boolean> {
  const native = getVidoraRemote();
  if (!native) return false;
  try {
    const item = await native.sendToComputer(input.url, input.title, input.downloadId ?? null);
    if (!item) {
      announce(translate('remoteControl.sendFailed'));
      return false;
    }
    useRemoteStore.setState({ sent: await native.listSentToComputer() });
    const running = useRemoteStore.getState().status.running;
    announce(translate(running ? 'remoteControl.sentRunning' : 'remoteControl.sentTurnOn'));
    return true;
  } catch {
    announce(translate('remoteControl.sendFailed'));
    return false;
  }
}

let attached = false;

/**
 * Once per JavaScript runtime: follows the server's status and takes every link handed to VidoraX from outside
 * (including links that waited while the app was closed) through Batch Add, one at a time.
 */
export function ensureRemoteControl(): void {
  const native = getVidoraRemote();
  if (attached || !native) return;
  attached = true;
  const intake = createLinkIntakeQueue({
    addLink: async (url, signal) => {
      const { addLinkFromBatch } = await import('@/browser/media-actions/batch-add.service');
      const result = await addLinkFromBatch(url, signal);
      return { outcome: result.outcome, title: result.title, downloadId: result.downloadId, detail: result.detail };
    },
    report: (requestId, outcome, title, downloadId, detail) =>
      native.reportLinkResult(requestId, outcome, title, downloadId, detail),
  });
  native.addListener('onRemoteStatus', (status) => setStatus(status));
  native.addListener('onLinkRequest', (request) => intake.enqueue(request));
  void refreshRemoteState().catch(() => undefined);
}
