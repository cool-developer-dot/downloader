import * as ReactNative from 'react-native';

import { translate } from '@/localization';

import { showInFolderTarget } from './save-location';
import { useExternalCopiesStore } from './save-location-store';
import { getTreeExportPort } from './tree-export-port';

function toast(message: string): void {
  if (ReactNative.Platform.OS === 'android') {
    ReactNative.ToastAndroid.show(message, ReactNative.ToastAndroid.SHORT);
  }
  ReactNative.AccessibilityInfo.announceForAccessibility(message);
}

const inFlight = new Set<string>();

/**
 * Show in Folder (#398), best effort: opens the folder that holds the item's external copy in the files app. When no
 * app opens folders (or the folder is gone), says where the copy was saved instead. A second tap while the first is
 * still opening does nothing. Never throws.
 */
export async function showItemInFolder(id: string): Promise<void> {
  if (!id || inFlight.has(id)) {
    return;
  }
  // Read right before acting: the record may have been forgotten since the button was drawn.
  const target = showInFolderTarget(useExternalCopiesStore.getState().records[id]);
  const port = getTreeExportPort();
  if (!target || !port) {
    return;
  }
  inFlight.add(id);
  try {
    const opened = await port.openFolder(target.folderUri).catch(() => false);
    if (!opened) {
      toast(translate('saveLocation.savedIn', { folder: target.folderLabel ?? target.name }));
    }
  } finally {
    inFlight.delete(id);
  }
}
