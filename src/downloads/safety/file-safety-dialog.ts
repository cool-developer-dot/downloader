// A namespace import: modules importing this one also run under Node tests, whose react-native stub has no Alert; it
// is only read when a warning is actually shown.
import * as ReactNative from 'react-native';

import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';
import { displayFileName } from '@/media-detection/adapters/dangerous-download';
import { translate } from '@/localization/translate';

import {
  allowFileAction,
  CONTENT_KIND_KEYS,
  createDisguisedNotifier,
  type FileSafetyAction,
  type FileSafetyWarning,
} from './file-safety';
import { onDisguisedProbe } from './probe-observations';

/** "Open anyway" (or Share / Extract / Save) and Cancel. Dismissing the dialog is Cancel. */
function confirmWarning(warning: FileSafetyWarning, fileName: string | null): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    ReactNative.Alert.alert(
      translate(warning.titleKey),
      translate(warning.messageKey, {
        fileName: displayFileName(fileName ?? '') || translate('dangerousFile.unnamed'),
        kind: warning.kindKey ? translate(warning.kindKey) : '',
      }),
      [
        { text: translate('common.cancel'), style: 'cancel', onPress: () => settle(false) },
        { text: translate(warning.proceedKey), style: 'destructive', onPress: () => settle(true) },
      ],
      { cancelable: true, onDismiss: () => settle(false) },
    );
  });
}

/**
 * P8 #461: true when a library file may be opened or shared — its bytes match its name, the check is unavailable
 * (an older build), or the user chose "… anyway".
 */
export function confirmLibraryFileAction(id: string, action: FileSafetyAction, fileName: string | null): Promise<boolean> {
  if (!isVidoraMediaAvailable()) {
    return Promise.resolve(true);
  }
  const media = getVidoraMedia();
  if (!media.checkLibraryFileSafety) {
    return Promise.resolve(true);
  }
  return allowFileAction(() => media.checkLibraryFileSafety!(id), action, (warning) => confirmWarning(warning, fileName));
}

/** P8 #461: the same for a file another app opened in VidoraX (before Save, Open with, or Extract). */
export function confirmIncomingFileAction(token: string, action: FileSafetyAction, fileName: string | null): Promise<boolean> {
  if (!isVidoraMediaAvailable()) {
    return Promise.resolve(true);
  }
  const media = getVidoraMedia();
  if (!media.checkIncomingFileSafety) {
    return Promise.resolve(true);
  }
  return allowFileAction(() => media.checkIncomingFileSafety!(token), action, (warning) => confirmWarning(warning, fileName));
}

/** The probe found a program behind a "video" link: VidoraX does not download it, and says why. */
function showDisguisedSource(kind: keyof typeof CONTENT_KIND_KEYS, url: string): void {
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    host = '';
  }
  ReactNative.Alert.alert(
    translate('fileSafety.disguisedDownloadTitle'),
    translate('fileSafety.disguisedSourceMessage', { kind: translate(CONTENT_KIND_KEYS[kind]), host: host || url.slice(0, 60) }),
    [{ text: translate('common.ok') }],
  );
}

let attached = false;

/** Idempotent: from now on a disguised program behind a video link gets one notice per link per app run. */
export function ensureDisguisedSourceNotices(): void {
  if (attached) {
    return;
  }
  attached = true;
  const notify = createDisguisedNotifier(showDisguisedSource);
  onDisguisedProbe((url, kind) => {
    notify(url, kind);
  });
}
