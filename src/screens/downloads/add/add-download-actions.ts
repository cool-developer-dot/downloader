import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { useSaveLocationStore } from '@/downloads/v2/save-location-store';
import { getTreeExportPort, pickTreeFolder } from '@/downloads/v2/tree-export-port';
import { translate } from '@/localization';
import { withExpectedSystemScreen } from '@/security/app-lock/expected-system-screen';

/** A short message over whatever is on screen, read out as well. */
export function announce(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
  AccessibilityInfo.announceForAccessibility(message);
}

/**
 * Add download → Scan QR: the same Google code scanner the browser's Scan QR uses (B22 #30, `share-qr.service`),
 * but the scanned text comes back to the caller — it fills the link field instead of opening the browser's
 * "Open <host>?" sheet.
 */
export async function scanLinkFromQr(): Promise<string | null> {
  const api = isVidoraWebAvailable() ? getVidoraWeb() : null;
  const scan = api?.scanQrCode;
  if (!api || !scan) {
    announce(translate('browserShare.scanUnavailable'));
    return null;
  }
  const result = await withExpectedSystemScreen(() => scan.call(api).catch(() => null));
  if (!result || result.status === 'unavailable') {
    announce(translate('browserShare.scanUnavailable'));
    return null;
  }
  if (result.status !== 'scanned') {
    return null;
  }
  const text = result.text?.trim() ?? '';
  return text || null;
}

export type SaveLocationPick = 'picked' | 'cancelled' | 'failed' | 'unavailable';

/**
 * Add download → Save location: the Save Location folder picker (#297) with the same steps as Download Settings
 * (pick → check the grant → remember the folder, turning the copy on; the previous grant is given back).
 */
export async function pickSaveLocation(): Promise<SaveLocationPick> {
  const port = getTreeExportPort();
  if (!port) {
    return 'unavailable';
  }
  const picked = await pickTreeFolder();
  if (!picked) {
    return 'cancelled';
  }
  if (!(await port.hasFolderAccess(picked).catch(() => false))) {
    return 'failed';
  }
  const name = await port.getFolderName(picked).catch(() => null);
  const previous = useSaveLocationStore.getState().treeUri;
  useSaveLocationStore.getState().dispatch({ type: 'picked', treeUri: picked, folderName: name, now: Date.now() });
  if (previous && previous !== picked) {
    void port.releaseFolderAccess(previous).catch(() => undefined);
  }
  return 'picked';
}

/** The folder label the Add and Video screens show: the chosen copy folder, else the default video folder. */
export function saveLocationLabel(state: { enabled: boolean; folderName: string | null }, fallback: string): string {
  return state.enabled && state.folderName?.trim() ? state.folderName.trim() : fallback;
}
