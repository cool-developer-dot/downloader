import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { useBlockScreenCapture } from './screen-capture-preference';
import { PRIVATE_FOLDER_SECURE_OWNER, privateFolderHoldsSecure } from './secure-window';
import { holdSecureWindow } from './secure-window.runtime';

/**
 * P11 #689: on a Private Folder screen, with "Block screenshots in Private" on, the window is secure while the screen
 * is in front (`privateFolderHoldsSecure`), and let go when it loses focus or unmounts. Incognito's hold, if any, stays.
 */
export function usePrivateFolderCaptureBlock(): void {
  const settingOn = useBlockScreenCapture();
  useFocusEffect(
    useCallback(() => {
      holdSecureWindow(PRIVATE_FOLDER_SECURE_OWNER, privateFolderHoldsSecure({ settingOn, screenFocused: true }));
      return () => holdSecureWindow(PRIVATE_FOLDER_SECURE_OWNER, false);
    }, [settingOn]),
  );
}
