import { memo, useMemo } from 'react';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { FolderEntry } from '@/files/ui/files-index';
import { lockFolder, removeFolderLock, useLockedFoldersStore } from '@/files/ui/locked-folders';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useAppLockStore } from '@/security/app-lock';

import { announce } from '../announce';

export type FolderMenuProps = {
  /** The folder whose ⋮ was tapped; null when the menu is closed. */
  folder: FolderEntry | null;
  onClose: () => void;
  testID?: string;
};

/**
 * Files F10 · #910: a folder's ⋮ — Lock folder, or Remove lock while it is open (after the PIN). Locking needs App
 * Lock's PIN, so without App Lock it offers the setup. F7 adds Color here.
 */
export const FolderMenu = memo(function FolderMenu({ folder, onClose, testID = 'files-folder-menu' }: FolderMenuProps) {
  const { t } = useTranslation();
  const locked = useLockedFoldersStore((state) => state.locked);
  const sessionUnlocked = useLockedFoldersStore((state) => state.sessionUnlocked);
  const appLockEnabled = useAppLockStore((state) => state.isEnabled);

  const actions = useMemo<ActionSheetItem[]>(() => {
    if (!folder) {
      return [];
    }
    const isLocked = locked.includes(folder.id);
    if (!isLocked) {
      return [
        {
          id: 'lock',
          label: t('fileManager.lockFolder'),
          onPress: () => {
            onClose();
            if (!appLockEnabled) {
              announce(t('fileManager.folderLockNeedsAppLock'));
              navigation.push(routePaths.appLockSetup);
              return;
            }
            lockFolder(folder.id);
            announce(t('fileManager.folderLockedToast'));
          },
        },
      ];
    }
    // The lock comes off only once the folder was opened with the PIN this session.
    return sessionUnlocked.includes(folder.id)
      ? [
          {
            id: 'remove-lock',
            label: t('fileManager.removeLock'),
            onPress: () => {
              onClose();
              removeFolderLock(folder.id);
              announce(t('fileManager.folderLockRemovedToast'));
            },
          },
        ]
      : [];
  }, [appLockEnabled, folder, locked, onClose, sessionUnlocked, t]);

  return (
    <ActionSheetModal
      visible={folder !== null}
      onClose={onClose}
      title={folder?.name}
      subtitle={t('fileManager.folderLockNote')}
      actions={actions}
      testID={testID}
    />
  );
});
