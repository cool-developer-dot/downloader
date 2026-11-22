// A namespace import: the adapter that imports this file also runs under Node tests, whose react-native stub has
// no Alert; it is only read when a dialog is actually shown.
import * as ReactNative from 'react-native';

import { hasAppDialogHost, showAppDialog } from '@/components/modals/app-dialog';
import { translate } from '@/localization/translate';

import {
  createSystemDownloadGate,
  displayFileName,
  type DownloadDangerInput,
  type DownloadDangerReason,
} from './dangerous-download';

/**
 * "Download anyway" / "Cancel", naming the file. Dismissing the dialog is Cancel. A disguised name (P8 #461: a double
 * extension, or a video-looking name sent as a program) gets the Malware Warning's stronger title and text.
 */
function confirmDangerousFile(fileName: string, reason: DownloadDangerReason | null): Promise<boolean> {
  const disguised = reason === 'double-extension' || reason === 'disguised';
  const name = displayFileName(fileName) || translate('dangerousFile.unnamed');
  const title = translate(disguised ? 'fileSafety.disguisedDownloadTitle' : 'dangerousFile.title');
  const message = disguised
    ? translate(reason === 'double-extension' ? 'fileSafety.doubleExtensionMessage' : 'fileSafety.disguisedDownloadMessage', {
        fileName: name,
      })
    : translate('dangerousFile.message', { fileName: name });
  // The app's themed dialog; the system one only before the app's providers are up.
  if (hasAppDialogHost()) {
    return showAppDialog({
      title,
      message,
      confirmLabel: translate('dangerousFile.downloadAnyway'),
      cancelLabel: translate('common.cancel'),
      variant: 'error',
    });
  }
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    ReactNative.Alert.alert(
      title,
      message,
      [
        { text: translate('common.cancel'), style: 'cancel', onPress: () => settle(false) },
        { text: translate('dangerousFile.downloadAnyway'), style: 'destructive', onPress: () => settle(true) },
      ],
      { cancelable: true, onDismiss: () => settle(false) },
    );
  });
}

/**
 * Dangerous File Warning (#157): true when this non-video WebView download may go to Android's DownloadManager.
 * No install or open action is ever offered for the file.
 */
const gate = createSystemDownloadGate(confirmDangerousFile);

export function confirmSystemDownload(input: DownloadDangerInput): Promise<boolean> {
  return gate(input);
}
