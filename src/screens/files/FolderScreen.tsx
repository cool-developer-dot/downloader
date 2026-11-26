import { router, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ds, DsCard, DsHeader, DsRow, DsRowGroup, DsScreen, DsText } from '@/design';
import { filesCapabilities } from '@/files/api';
import type { FileEntry, FolderEntry } from '@/files/ui/files-index';
import { useFilesViewSettings } from '@/files/ui/files-view-settings';
import { folderLookupOf } from '@/files/ui/folder-tree';
import { inSelectionOrder } from '@/files/ui/selection';
import { useSelection } from '@/files/ui/use-selection';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import { useAndroidBackHandler } from '@/navigation/hooks';

import { announce } from './announce';
import { Breadcrumbs } from './components/Breadcrumbs';
import { FileEntriesList } from './components/FileEntriesList';
import { NewFolderDialog } from './components/NewFolderDialog';
import { SelectionBar, type SelectedEntry } from './components/SelectionBar';
import { SelectionHeader } from './components/SelectionHeader';
import { useFolderView } from './hooks/use-files-data';
import { useFilesSettingsAction } from './hooks/use-files-settings-action';
import { useOpenFile } from './hooks/use-open-file';
import { FileActionsSheet } from './FileActionsSheet';
import { backTarget, buildBreadcrumbs, upTarget } from './utils/breadcrumbs';
import { folderListEntries, folderMetaLine, itemCountText } from './utils/file-rows';

function paramOf(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/**
 * Files F1 · #741 Open folder, #742 Back, #743 Up one level (`/files/folder/[id]`): a VidoraX folder's subfolders and
 * files in F2's order and view, under a tappable breadcrumb. One screen walks the whole tree by changing its `id`: a
 * subfolder, a crumb and "Up to {parent}" set it, and header back / Android back go one level up until the Files tab —
 * so C → B → A → Files holds however C was reached. A folder deleted while open hands the screen to the nearest folder
 * of its path that still exists.
 */
export const FolderScreen = memo(function FolderScreen() {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const params = useLocalSearchParams<{ id?: string | string[]; highlight?: string | string[] }>();
  const folderId = paramOf(params.id);
  const highlightId = paramOf(params.highlight) || undefined;
  const { data, status, refreshing, refresh, reload } = useFolderView(folderId);
  const settings = useFilesViewSettings();
  const settingsAction = useFilesSettingsAction();
  const [menuFile, setMenuFile] = useState<FileEntry | null>(null);
  // "New folder inside" (F12): only while nested folders are live (`filesCapabilities.nestedFolders`).
  const [newFolderOpen, setNewFolderOpen] = useState(false);

  const lookup = useMemo(() => folderLookupOf(data.path), [data.path]);
  const crumbs = useMemo(() => buildBreadcrumbs(folderId, lookup, t('filesTab.title')), [folderId, lookup, t]);
  const up = upTarget(folderId, lookup);
  const folder = data.folder;

  const entries = useMemo(() => {
    if (!data.listing) {
      return [];
    }
    const folderSizes: Record<string, number> = {};
    for (const [id, stats] of Object.entries(data.statsById)) {
      folderSizes[id] = stats.totalBytes;
    }
    return folderListEntries(data.listing.folders, data.listing.files, { ...settings, folderSizes });
  }, [data.listing, data.statsById, settings]);
  const shownFiles = useMemo(() => entries.flatMap((entry) => (entry.kind === 'file' ? [entry.file] : [])), [entries]);
  // F4: a long press selects (folders too); the selection bar acts on the selection.
  const keys = useMemo(() => entries.map((entry) => entry.key), [entries]);
  const selection = useSelection(keys);
  const selectedEntries = useMemo<SelectedEntry[]>(
    // In the order they were picked (F5's Number them follows it).
    () => inSelectionOrder(entries, selection.selected),
    [entries, selection.selected],
  );
  const { clear: clearSelection } = selection;
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
  const folderMeta = useCallback((target: FolderEntry) => folderMetaLine(data.statsById[target.id], t), [data.statsById, t]);
  const onRefresh = useCallback(() => void refresh(), [refresh]);
  const closeMenu = useCallback(() => setMenuFile(null), []);
  const onChanged = useCallback(() => void reload(), [reload]);
  const afterBatch = useCallback(() => {
    clearSelection();
    void reload();
  }, [clearSelection, reload]);

  const header = (
    <View style={{ gap: ds.space.stack, paddingBottom: ds.space.stack }}>
      {selection.active ? (
        <SelectionHeader count={selection.count} onClose={selection.clear} onSelectAll={selection.selectAll} onInvert={selection.invert} />
      ) : (
        <DsHeader
          title={folder?.name ?? crumbs[crumbs.length - 1]!.label}
          subtitle={data.listing ? itemCountText(entries.length, t) : undefined}
          onBack={goUp}
          action={settingsAction}
        />
      )}
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
      {filesCapabilities.nestedFolders && folder ? (
        <DsRowGroup>
          <DsRow
            icon="folder-plus"
            title={t('downloads.newFolder')}
            accessibilityLabel={t('fileManager.newFolderInside', { name: folder.name })}
            onPress={() => setNewFolderOpen(true)}
            trailing="none"
            testID="files-folder-new-folder"
          />
        </DsRowGroup>
      ) : null}
    </View>
  );

  const empty =
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
    );

  return (
    <DsScreen scroll={false} edges={['top', 'bottom']} testID="files-folder-screen">
      <FileEntriesList
        entries={entries}
        header={header}
        empty={empty}
        folderMeta={folderMeta}
        onPressFile={openFile}
        onMoreFile={setMenuFile}
        onPressFolder={openFolder}
        refreshing={refreshing}
        onRefresh={onRefresh}
        highlightId={highlightId}
        selection={selection}
        testID="files-folder-list"
      />
      {selection.active ? <SelectionBar entries={selectedEntries} onDone={afterBatch} /> : null}
      <FileActionsSheet file={menuFile} onClose={closeMenu} onOpen={openFile} onChanged={onChanged} />
      {filesCapabilities.nestedFolders ? (
        <NewFolderDialog visible={newFolderOpen} parentId={folderId} onClose={() => setNewFolderOpen(false)} testID="files-folder-new-folder-dialog" />
      ) : null}
    </DsScreen>
  );
});
