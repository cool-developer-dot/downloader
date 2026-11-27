import { memo } from 'react';

import { DsChip, DsRow } from '@/design';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import { routePaths } from '@/navigation/constants/route-paths';

import { folderAccessAvailable, useAddedFoldersStore } from './folder-access-api';

/**
 * F15 · design 26: the Files tab's "SD card" and "Folders I added" chips (after "Internal"). Faran's agreed addition
 * to Hamza's FilesScreen: put `<FolderAccessChips />` right after the Internal chip in its DsChipRow. Hidden on a
 * build without the native folder calls.
 */
export const FolderAccessChips = memo(function FolderAccessChips() {
  const { t } = useTranslation();
  if (!folderAccessAvailable()) {
    return null;
  }
  return (
    <>
      <DsChip
        label={t('filesCore.sdCardChip')}
        onPress={() => navigation.push({ pathname: routePaths.addedFolders, params: { only: 'sd' } })}
        testID="files-chip-sd-card"
      />
      <DsChip
        label={t('filesCore.foldersChip')}
        onPress={() => navigation.push(routePaths.addedFolders)}
        testID="files-chip-added-folders"
      />
    </>
  );
});

/** F15 · design 27's STORAGE ACCESS row ("Folders VidoraX can open"), for Hamza's File manager settings (F2). */
export const FolderAccessSettingsRow = memo(function FolderAccessSettingsRow() {
  const { t } = useTranslation();
  const count = useAddedFoldersStore((state) => state.folders.length);
  if (!folderAccessAvailable()) {
    return null;
  }
  return (
    <DsRow
      icon="folder"
      title={t('filesCore.storageAccessRow')}
      subtitle={count === 1 ? t('filesCore.storageAccessRowSubOne') : t('filesCore.storageAccessRowSub', { count })}
      onPress={() => navigation.push(routePaths.addedFolders)}
      testID="files-settings-folder-access"
    />
  );
});
