// A namespace import: the adapter that imports this file also runs under Node tests, whose react-native stub has
// no Alert; it is only read when a dialog is actually shown.
import * as ReactNative from 'react-native';

import { translate } from '@/localization/translate';

import { allowSystemDownload, type DownloadDangerInput } from './dangerous-download';

/** "Download anyway" / "Cancel", naming the file. Dismissing the dialog is Cancel. */
function confirmDangerousFile(fileName: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    ReactNative.Alert.alert(
      translate('dangerousFile.title'),
      translate('dangerousFile.message', { fileName: fileName || translate('dangerousFile.unnamed') }),
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
export function confirmSystemDownload(input: DownloadDangerInput): Promise<boolean> {
  return allowSystemDownload(input, confirmDangerousFile);
}
