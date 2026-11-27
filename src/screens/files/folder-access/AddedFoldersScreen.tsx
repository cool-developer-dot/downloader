import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useState } from 'react';
import { Alert, View } from 'react-native';

import { DsButton, DsHeader, DsRow, DsRowGroup, DsScreen, DsText } from '@/design';
import { addFolder, listAddedFolders, removeFolder, type AddedFolderView } from '@/files/folder-access/folder-access-api';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import { routePaths } from '@/navigation/constants/route-paths';

/**
 * F15 · design 27 "Folders VidoraX can open" (and the Files tab's "SD card" / "Folders I added" chips with `only`).
 * Lists the folders the user picked in Android's folder picker; Add opens that picker, a long press removes one.
 */
export const AddedFoldersScreen = memo(function AddedFoldersScreen() {
  const { t } = useTranslation();
  const { only } = useLocalSearchParams<{ only?: string }>();
  const sdOnly = only === 'sd';
  const [folders, setFolders] = useState<AddedFolderView[]>([]);

  const reload = useCallback(() => {
    const all = listAddedFolders();
    setFolders(sdOnly ? all.filter((folder) => folder.removable) : all);
  }, [sdOnly]);

  useFocusEffect(reload);

  const add = useCallback(async () => {
    const folder = await addFolder();
    if (folder) {
      reload();
    }
  }, [reload]);

  const open = useCallback(
    (folder: AddedFolderView) => {
      if (!folder.accessible) {
        void add();
        return;
      }
      navigation.push({ pathname: routePaths.addedFolder, params: { tree: folder.treeUri, name: folder.label } });
    },
    [add],
  );

  const confirmRemove = useCallback(
    (folder: AddedFolderView) => {
      Alert.alert(t('filesCore.removeTitle', { name: folder.label }), t('filesCore.removeMessage'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('filesCore.remove'),
          style: 'destructive',
          onPress: () => void removeFolder(folder.treeUri).then(reload),
        },
      ]);
    },
    [reload, t],
  );

  return (
    <DsScreen testID="added-folders-screen">
      <DsHeader
        title={sdOnly ? t('filesCore.sdCardTitle') : t('filesCore.foldersTitle')}
        subtitle={sdOnly ? t('filesCore.sdCardSub') : t('filesCore.foldersSub')}
        onBack={() => navigation.back()}
      />
      {folders.length > 0 ? (
        <DsRowGroup>
          {folders.map((folder) => (
            <DsRow
              key={folder.treeUri}
              icon="folder"
              title={folder.label}
              subtitle={
                folder.accessible
                  ? folder.removable
                    ? t('filesCore.onSdCard')
                    : t('filesCore.onPhone')
                  : t('filesCore.accessLost')
              }
              onPress={() => open(folder)}
              onLongPress={() => confirmRemove(folder)}
              accessibilityHint={t('filesCore.folderRowHint')}
              testID={`added-folder-${folder.label}`}
            />
          ))}
        </DsRowGroup>
      ) : (
        <View style={{ paddingVertical: 24, gap: 6 }}>
          <DsText variant="rowTitle">{sdOnly ? t('filesCore.noSdFolders') : t('filesCore.noFolders')}</DsText>
          <DsText variant="rowSub">{t('filesCore.noFoldersHint')}</DsText>
        </View>
      )}
      <View style={{ marginTop: 16 }}>
        <DsButton
          label={sdOnly ? t('filesCore.addFromSd') : t('filesCore.addFolder')}
          icon="plus"
          fullWidth
          onPress={() => void add()}
          testID="added-folders-add"
        />
      </View>
    </DsScreen>
  );
});
