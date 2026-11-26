import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View, type ListRenderItem } from 'react-native';

import {
  ds,
  DsButton,
  DsCard,
  DsChip,
  DsChipRow,
  DsHeader,
  DsRow,
  DsRowGroup,
  DsScreen,
  DsSectionLabel,
  DsText,
  DsTile,
  DsTileGrid,
} from '@/design';
import type { FolderEntry } from '@/files/ui/files-index';
import { useFilesViewSettings } from '@/files/ui/files-view-settings';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { filesFolderPath, filesTypePath, navigation, routePaths } from '@/navigation';

import { FolderRow } from './components/FolderRow';
import { NewFolderDialog } from './components/NewFolderDialog';
import { useFilesHome } from './hooks/use-files-data';
import { folderListEntries, folderMetaLine, formatFileBytes } from './utils/file-rows';
import { buildTypeTiles, tileA11y } from './utils/type-tiles';

/**
 * Files tab (design 26 "Files · Browse", Files F1): VidoraX's own files by type — six tiles with their counts — the
 * Private folder, and the top-level VidoraX folders with "{n} items · {size}". Everything comes through
 * `files-source.ts`; pull to refresh rescans the library. Faran's F15 adds the SD card and "Folders I added" chips;
 * F6 brings back the search button.
 */
export const FilesScreen = memo(function FilesScreen() {
  const theme = useTheme();
  const { t, language } = useTranslation();
  const { data, status, refreshing, refresh } = useFilesHome();
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const settings = useFilesViewSettings();

  const free = formatFileBytes(data.space?.freeBytes);
  const subtitle = free ? t('fileManager.subtitleFree', { free }) : t('filesTab.subtitle');
  const tiles = buildTypeTiles(data.counts, data.videoCount);
  // The folders in F2's order (Name ascending by default; Size counts everything in a folder).
  const folders = useMemo(() => {
    const folderSizes: Record<string, number> = {};
    for (const [id, stats] of Object.entries(data.statsById)) {
      folderSizes[id] = stats.totalBytes;
    }
    return folderListEntries(data.listing?.folders ?? [], [], { ...settings, folderSizes }).flatMap((entry) =>
      entry.kind === 'folder' ? [entry.folder] : [],
    );
  }, [data.listing, data.statsById, settings]);

  const openFolder = useCallback((folder: FolderEntry) => navigation.push(filesFolderPath(folder.id)), []);
  const openPrivate = useCallback(() => navigation.push(routePaths.private), []);
  const onRefresh = useCallback(() => void refresh(), [refresh]);

  const renderFolder = useCallback<ListRenderItem<FolderEntry>>(
    ({ item, index }) => (
      <FolderRow
        folder={item}
        meta={folderMetaLine(data.statsById[item.id], t)}
        first={index === 0}
        last={index === folders.length - 1}
        onPress={openFolder}
        testID={`files-folder-${item.id}`}
      />
    ),
    [data.statsById, folders.length, openFolder, t],
  );

  const header = (
    <View style={{ gap: ds.space.stack, paddingBottom: ds.space.sectionBottom }}>
      {/* F6 adds the search button (design 26's 🔍) once Files search exists. */}
      <DsHeader title={t('filesTab.title')} subtitle={subtitle} />
      <DsChipRow>
        <DsChip label={t('filesTab.internal')} selected />
      </DsChipRow>
      <DsTileGrid>
        {tiles.map((tile) => {
          const label = t(tile.labelKey);
          const a11y = tileA11y(tile, label);
          return (
            <DsTile
              key={tile.type}
              icon={tile.icon}
              label={label}
              accessibilityLabel={t(a11y.key, a11y.params)}
              accessibilityHint={t('fileManager.tileHint')}
              onPress={() => navigation.push(filesTypePath(tile.type))}
              testID={`files-tile-${tile.type}`}
            />
          );
        })}
      </DsTileGrid>
      <DsRowGroup>
        <DsRow
          icon="lock"
          title={t('filesTab.privateFolder')}
          subtitle={t('filesTab.privateFolderHint')}
          onPress={openPrivate}
          testID="files-private-folder"
        />
      </DsRowGroup>
      <DsSectionLabel>{t('filesTab.folders')}</DsSectionLabel>
    </View>
  );

  const empty =
    status === 'loading' ? (
      <View style={{ paddingVertical: 24, alignItems: 'center' }}>
        <ActivityIndicator color={theme.colors.primary} accessibilityLabel={t('common.loading')} />
      </View>
    ) : (
      <DsCard testID="files-folders-empty">
        <View style={{ gap: 6, alignItems: 'center', paddingVertical: 8 }}>
          <DsText variant="bodyStrong" align="center">
            {status === 'error' ? t('fileManager.loadFailed') : t('fileManager.foldersEmpty')}
          </DsText>
          {status === 'error' ? null : (
            <DsText variant="body" align="center">
              {t('fileManager.foldersEmptyHint')}
            </DsText>
          )}
          <DsButton
            label={t('downloads.newFolder')}
            icon="folder-plus"
            onPress={() => setNewFolderOpen(true)}
            style={{ marginTop: 8 }}
            testID="files-new-folder-button"
          />
        </View>
      </DsCard>
    );

  return (
    <DsScreen scroll={false} testID="files-screen">
      <FlatList
        data={folders}
        keyExtractor={(folder) => folder.id}
        renderItem={renderFolder}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          folders.length > 0 ? (
            <DsButton
              label={t('downloads.newFolder')}
              icon="folder-plus"
              variant="secondary"
              onPress={() => setNewFolderOpen(true)}
              style={{ marginTop: ds.space.stack }}
              testID="files-new-folder-footer"
            />
          ) : null
        }
        contentContainerStyle={{ paddingHorizontal: ds.space.screenX, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
            accessibilityLabel={t('common.refreshA11y')}
          />
        }
        extraData={language}
        testID="files-list"
      />
      <NewFolderDialog visible={newFolderOpen} onClose={() => setNewFolderOpen(false)} />
    </DsScreen>
  );
});
