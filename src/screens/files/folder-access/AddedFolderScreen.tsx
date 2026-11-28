import { useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, View } from 'react-native';

import { ds, DsHeader, DsRow, DsScreen, DsText } from '@/design';
import type { DsIconName } from '@/design/DsIcon';
import type { FileType } from '@/files/engine/file-types';
import { importFolder, listPicked, playableIdOf, type PickedDocument } from '@/files/folder-access/folder-access-api';
import { translatePlural, useTranslation } from '@/localization';
import { navigation, openPlayer } from '@/navigation';
import { routePaths } from '@/navigation/constants/route-paths';
import { formatBytesLabel } from '@/storage-manager';

const ICON: Record<FileType, DsIconName> = {
  video: 'film',
  audio: 'music',
  image: 'image',
  doc: 'file-text',
  archive: 'archive',
  apk: 'package',
  other: 'file-down',
};

/**
 * F15: inside a folder the user picked (and its subfolders). Read-only: videos and audio play in place, subfolders
 * open, and the header's button copies the folder's videos into VidoraX. Nothing here is renamed or deleted.
 */
export const AddedFolderScreen = memo(function AddedFolderScreen() {
  const { t } = useTranslation();
  const { tree, doc, name } = useLocalSearchParams<{ tree: string; doc?: string; name?: string }>();
  const [items, setItems] = useState<PickedDocument[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setItems(null);
    setError(false);
    listPicked(tree, doc ?? null)
      .then((docs) => alive && setItems(docs))
      .catch(() => alive && (setItems([]), setError(true)));
    return () => {
      alive = false;
    };
  }, [doc, tree]);

  const openItem = useCallback(
    (item: PickedDocument) => {
      if (item.isDirectory) {
        navigation.push({ pathname: routePaths.addedFolder, params: { tree, doc: item.documentId, name: item.name } });
        return;
      }
      const mediaId = playableIdOf(item);
      if (mediaId) {
        const queue = (items ?? []).map(playableIdOf).filter((id): id is string => Boolean(id));
        openPlayer(mediaId, queue);
      }
    },
    [items, tree],
  );

  const runImport = useCallback(async () => {
    const result = await importFolder(tree).catch(() => null);
    Alert.alert(
      t('filesCore.importTitle'),
      result
        ? [
            t('filesCore.importCopied', { count: result.imported }),
            result.duplicates > 0 ? translatePlural(result.duplicates, { one: 'filesCore.importAlreadyOne', other: 'filesCore.importAlready' }) : '',
          ]
            .filter(Boolean)
            .join(' ')
        : t('filesCore.importFailed'),
    );
  }, [t, tree]);

  return (
    <DsScreen scroll={false} contentContainerStyle={{ paddingHorizontal: ds.space.screenX }} testID="added-folder-screen">
      <DsHeader
        title={name || t('filesCore.foldersTitle')}
        subtitle={items ? (items.length === 1 ? t('filesCore.itemCountOne') : t('filesCore.itemCount', { count: items.length })) : undefined}
        onBack={() => navigation.back()}
        action={doc ? undefined : { icon: 'download', accessibilityLabel: t('filesCore.importA11y'), onPress: () => void runImport() }}
      />
      {items == null ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.documentId}
          renderItem={({ item }) => {
            const playable = !item.isDirectory && (item.fileType === 'video' || item.fileType === 'audio');
            const size = item.sizeBytes != null ? formatBytesLabel(item.sizeBytes) : null;
            return (
              <DsRow
                icon={item.isDirectory ? 'folder' : ICON[item.fileType ?? 'other']}
                title={item.name}
                subtitle={item.isDirectory ? t('filesCore.folder') : (size ?? undefined)}
                onPress={item.isDirectory || playable ? () => openItem(item) : undefined}
                disabled={!item.isDirectory && !playable}
                testID={`added-folder-item-${item.name}`}
              />
            );
          }}
          ListEmptyComponent={
            <View style={{ paddingVertical: 24 }}>
              <DsText variant="rowSub">{error ? t('filesCore.cantRead') : t('filesCore.emptyFolder')}</DsText>
            </View>
          }
        />
      )}
    </DsScreen>
  );
});
