import { useEffect } from 'react';

import { registerFilesBackupKey } from '@/backup/files-section.runtime';
import { relockAllFolders, relocksOn, reloadLockedFolders } from '@/files/ui/locked-folders';
import { mmkvKeys } from '@/storage/constants';
import { APP_SECURE_OWNER, appHoldsSecure } from '@/privacy/secure-window';
import { holdSecureWindow } from '@/privacy/secure-window.runtime';
import { useAppLockStore } from '@/security/app-lock';

import { useSecuritySettings } from './security-settings';

// Files F10 (Faran's F17): which folders are locked joins every backup (folder ids only — never the PIN).
registerFilesBackupKey(mmkvKeys.filesLockedFolders, reloadLockedFolders);

/**
 * Files F10, mounted once in the app's stack:
 * - #916 Block screenshots: with Security → Block screenshots on, the app's window is secure on every screen (the
 *   one secure-window arbiter, so Incognito's and Private's holds stay their own).
 * - #910 Folder lock: every locked folder locks again when the app locks (App Lock's Lock after) or App Lock is turned
 *   off.
 */
export function SecurityHost(): null {
  const { blockScreenshots } = useSecuritySettings();

  useEffect(() => {
    holdSecureWindow(APP_SECURE_OWNER, appHoldsSecure({ settingOn: blockScreenshots }));
  }, [blockScreenshots]);

  useEffect(
    () =>
      useAppLockStore.subscribe((state, previous) => {
        if (relocksOn(previous, state)) {
          relockAllFolders();
        }
      }),
    [],
  );

  return null;
}
