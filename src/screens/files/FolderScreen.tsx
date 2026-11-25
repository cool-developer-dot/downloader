import { router, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View, type ListRenderItem } from 'react-native';

import { ds, DsCard, DsHeader, DsRow, DsRowGroup, DsScreen, DsText } from '@/design';
import type { FileEntry, FolderEntry } from '@/files/ui/files-index';
import { folderLookupOf } from '@/files/ui/folder-tree';
import { useTheme } from '@/hooks/use-theme';
import { intlLocaleForLanguage, useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import { useAndroidBackHandler } from '@/navigation/hooks';

import { announce } from './announce';
import { Breadcrumbs } from './components/Breadcrumbs';
import { FileMenu } from './components/FileMenu';
import { FileRow } from './components/FileRow';
import { FolderRow } from './components/FolderRow';
import { useFolderView } from './hooks/use-files-data';
import { useOpenFile } from './hooks/use-open-file';
import { backTarget, buildBreadcrumbs, upTarget } from './utils/breadcrumbs';
import { fileMetaLine, folderListEntries, folderMetaLine, itemCountText, type FolderListEntry } from './utils/file-rows';

function paramOf(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/**
 * Files F1 · #741 Open folder, #742 Back, #743 Up one level (`/files/folder/[id]`): a VidoraX folder's subfolders, then
 * its files (F2's settings choose the order), under a tappable breadcrumb. One screen walks the whole tree by changing
 * its `id`: a subfolder, a crumb and "Up to {parent}" set it, and header back / Android back go one level up until the
 * Files tab — so C → B → A → Files holds however C was reached. A folder deleted while open hands the screen to the
 * nearest folder of its path that still exists.
 */
export const FolderScreen = memo(function FolderScreen() {
  const theme = useTheme();
  const { t, language, rtl } = useTranslation();
  const folderId = paramOf(useLocalSearchParams<{ id?: string | string[] }>().id);
  const { data, status, refreshing, refresh, reload } = useFolderView(folderId);
  const [menuFile, setMenuFile] = useState<FileEntry | null>(null);
  const locale = intlLocaleForLanguage(language);

  const lookup = useMemo(() => folderLookupOf(data.path), [data.path]);
  const crumbs = useMemo(() => buildBreadcrumbs(folderId, lookup, t('filesTab.title')), [folderId, lookup, t]);
  const up = upTarget(folderId, lookup);
  const folder = data.listing?.folder ?? null;

  const entries = useMemo<FolderListEntry[]>(
    () => (data.listing ? folderListEntries(data.listing.folders, data.listing.files, { foldersFirst: true }) : []),
    [data.listing],
  );
  const shownFiles = useMemo(() => entries.flatMap((entry) => (entry.kind === 'file' ? [entry.file] : [])), [entries]);
  const openFile = useOpenFile(shownFiles);

  /** Shows another folder in this screen; `null` leaves for the Files tab. */
  const goTo = useCallback((id: string | null) => {
    if (id) {
      router.setParams({ id });
    } else {
      navigation.back();
    }
  }, []);

  const goUp = useCallback(() => goTo(backTarget(folderId, lookup)), [folderId, goTo, lookup]);

  useAndroidBackHandler({
    onBackPress: () => {
      goUp();
      return true;
    },
  });

  // Deleted while open: the nearest folder of its path that still exists, or the Files tab.
  const gone = data.gone;
  useEffect(() => {
    if (gone) {
      announce(t('fileManager.folderGone'));
      goTo(gone.fallbackId);
    }
  }, [gone, goTo, t]);

  const openFolder = useCallback((target: FolderEntry) => goTo(target.id), [goTo]);
  const onRefresh = useCallback(() => void refresh(), [refresh]);
  const closeMenu = useCallback(() => setMenuFile(null), []);
  const onChanged = useCallback(() => void reload(), [reload]);

  const renderEntry = useCallback<ListRenderItem<FolderListEntry>>(
    ({ item, index }) => {
      const first = index === 0;
      const last = index === entries.length - 1;
      return item.kind === 'folder' ? (
        <FolderRow
          folder={item.folder}
          meta={folderMetaLine(data.statsById[item.folder.id], t)}
          first={first}
          last={last}
          onPress={openFolder}
          testID={`files-folder-${item.folder.id}`}
        />
      ) : (
        <FileRow
          file={item.file}
          name={item.file.name}
          meta={fileMetaLine(item.file, locale)}
          first={first}
          last={last}
          onPress={openFile}
          onMore={setMenuFile}
          testID={`files-file-${item.file.id}`}
        />
      );
    },
    [data.statsById, entries.length, locale, openFile, openFolder, t],
  );

  const header = (
    <View style={{ gap: ds.space.stack, paddingBottom: ds.space.stack }}>
      <DsHeader
        title={folder?.name ?? crumbs[crumbs.length - 1]!.label}
        subtitle={data.listing ? itemCountText(entries.length, t) : undefined}
        onBack={goUp}
      />
      <Breadcrumbs crumbs={crumbs} onPressCrumb={goTo} />
      {up ? (
        <DsRowGroup>
          <DsRow
            icon={rtl.isRtl ? 'corner-right-up' : 'corner-left-up'}
            title={t('fileManager.upTo', { name: up.name })}
            accessibilityLabel={t('fileManager.upToA11y', { name: up.name })}
            onPress={() => goTo(up.id)}
            trailing="none"
            testID="files-folder-up"
          />
        </DsRowGroup>
      ) : null}
    </View>
  );

  return (
    <DsScreen scroll={false} edges={['top', 'bottom']} testID="files-folder-screen">
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.key}
        renderItem={renderEntry}
        ListHeaderComponent={header}
        ListEmptyComponent={
          status === 'error' ? (
            <DsCard testID="files-folder-error">
              <DsText variant="bodyStrong" align="center">
                {t('fileManager.loadFailed')}
              </DsText>
            </DsCard>
          ) : status === 'loading' || !data.listing ? (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <ActivityIndicator color={theme.colors.primary} accessibilityLabel={t('common.loading')} />
            </View>
          ) : (
            <DsCard testID="files-folder-empty">
              <View style={{ gap: 6, alignItems: 'center', paddingVertical: 8 }}>
                <DsText variant="bodyStrong" align="center">
                  {t('fileManager.folderEmpty')}
                </DsText>
                <DsText variant="body" align="center">
                  {t('fileManager.folderEmptyHint')}
                </DsText>
              </View>
            </DsCard>
          )
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
        testID="files-folder-list"
      />
      <FileMenu file={menuFile} onClose={closeMenu} onOpen={openFile} onChanged={onChanged} />
    </DsScreen>
  );
});
