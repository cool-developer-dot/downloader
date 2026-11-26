import { useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ds, DsButton, DsCard, DsHeader, DsScreen, DsText } from '@/design';
import { folderPath } from '@/files/ui/files-source';
import { lockedNowIds, needsUnlock, unlockFolderForSession, useLockedFoldersStore } from '@/files/ui/locked-folders';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useAppLockStore } from '@/security/app-lock';
import { PrivatePinGate } from '@/screens/private/PrivatePinGate';

import { FolderScreen } from './FolderScreen';

function paramOf(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

type Path = { folderId: string; ids: string[]; name: string | null };

/**
 * Files F10 · #910 Folder lock (`/files/folder/[id]`): a locked folder — or one inside a locked folder — asks for the App
 * Lock PIN or a fingerprint (the Private PIN pad, design 28) before the folder screen shows. It then stays open for the
 * session; when the app locks, every locked folder locks again and this gate shows once more, even on an open screen.
 * Without App Lock there is no PIN: it offers the setup. A locked folder is hidden, not encrypted.
 */
export const LockedFolderGate = memo(function LockedFolderGate() {
  const theme = useTheme();
  const { t } = useTranslation();
  const folderId = paramOf(useLocalSearchParams<{ id?: string | string[] }>().id);
  const locked = useLockedFoldersStore((state) => state.locked);
  const sessionUnlocked = useLockedFoldersStore((state) => state.sessionUnlocked);
  const appLockEnabled = useAppLockStore((state) => state.isEnabled);
  const [path, setPath] = useState<Path | null>(null);

  // The folder's path (its locked parents count too). Only needed while any folder is locked.
  const anyLocked = locked.length > 0;
  useEffect(() => {
    if (!anyLocked || !folderId) {
      return undefined;
    }
    let live = true;
    void folderPath(folderId)
      .catch(() => [])
      .then((entries) => {
        if (live) {
          setPath({ folderId, ids: entries.map((entry) => entry.id), name: entries[entries.length - 1]?.name ?? null });
        }
      });
    return () => {
      live = false;
    };
  }, [anyLocked, folderId]);

  const unlock = useCallback(() => {
    const ids = path?.folderId === folderId ? path.ids : [folderId];
    for (const id of lockedNowIds(locked, new Set(sessionUnlocked))) {
      if (id === folderId || ids.includes(id)) {
        unlockFolderForSession(id);
      }
    }
  }, [folderId, locked, path, sessionUnlocked]);

  if (!anyLocked) {
    return <FolderScreen />;
  }
  const knownPath = path?.folderId === folderId ? path : null;
  const directlyLocked = lockedNowIds(locked, new Set(sessionUnlocked)).includes(folderId);
  // Walking from an open folder to its subfolder or back up stays on the open screen while the new path loads (only a
  // folder that is itself locked can ask); a folder opened cold waits for its path.
  if (!knownPath && !directlyLocked && path) {
    return <FolderScreen />;
  }
  if (!knownPath && !directlyLocked) {
    return (
      <DsScreen scroll={false} edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={theme.colors.primary} accessibilityLabel={t('common.loading')} />
        </View>
      </DsScreen>
    );
  }
  if (knownPath && !needsUnlock(folderId, knownPath.ids, locked, new Set(sessionUnlocked))) {
    return <FolderScreen />;
  }

  const name = knownPath?.name ?? t('fileManager.folderActions');
  return (
    <DsScreen
      scroll={false}
      edges={['top', 'bottom']}
      testID="files-locked-folder"
      fixedHeader={
        <View style={{ paddingHorizontal: ds.space.screenX }}>
          <DsHeader title={name} subtitle={t('fileManager.folderLockSubtitle')} onBack={() => navigation.back()} />
        </View>
      }>
      {appLockEnabled ? (
        <PrivatePinGate
          onVerified={unlock}
          title={name}
          subtitle={t('fileManager.folderLockNote')}
          showDataLossNotice={false}
          testID="files-folder-pin-gate"
        />
      ) : (
        <View style={{ paddingHorizontal: ds.space.screenX, paddingTop: 12 }}>
          <DsCard>
            <View style={{ gap: 8 }}>
              <DsText variant="bodyStrong">{t('fileManager.folderLockNeedsAppLock')}</DsText>
              <DsButton
                label={t('privateVault.setUpAppLock')}
                onPress={() => navigation.push(routePaths.appLockSetup)}
                fullWidth
                testID="files-folder-set-up-app-lock"
              />
            </View>
          </DsCard>
        </View>
      )}
    </DsScreen>
  );
});
