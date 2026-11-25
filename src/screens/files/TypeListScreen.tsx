import { useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ds, DsCard, DsHeader, DsScreen, DsText } from '@/design';
import { fileTypeOf, type FileEntry } from '@/files/ui/files-source';
import { useFilesViewSettings } from '@/files/ui/files-view-settings';
import { useSelection } from '@/files/ui/use-selection';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';

import { FileEntriesList } from './components/FileEntriesList';
import { SelectionBar, type SelectedEntry } from './components/SelectionBar';
import { SelectionHeader } from './components/SelectionHeader';
import { useAllFiles } from './hooks/use-files-data';
import { useFilesSettingsAction } from './hooks/use-files-settings-action';
import { useOpenFile } from './hooks/use-open-file';
import { FileActionsSheet } from './FileActionsSheet';
import { fileCountText, folderListEntries, formatFileBytes } from './utils/file-rows';
import { isTileType, tileLabelKey } from './utils/type-tiles';

function paramOf(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

const noFolderMeta = () => '';
const noFolderPress = () => undefined;

/**
 * Files F1 · #753 Categories: one type tile's files (`/files/type/[type]`) — exactly the library files `fileTypeOf()`
 * gives that type, from every folder, in F2's order and view. A tap opens the file; ⋮ opens its menu; ⚙ opens File
 * manager settings.
 */
export const TypeListScreen = memo(function TypeListScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ type?: string | string[]; highlight?: string | string[] }>();
  const type = paramOf(params.type);
  const highlightId = paramOf(params.highlight) || undefined;
  const { data: allFiles, status, refreshing, refresh, reload } = useAllFiles();
  const settings = useFilesViewSettings();
  const settingsAction = useFilesSettingsAction();
  const [menuFile, setMenuFile] = useState<FileEntry | null>(null);

  const entries = useMemo(() => {
    if (!isTileType(type)) {
      return [];
    }
    const ofType = allFiles.filter((file) => fileTypeOf({ mimeType: file.mimeType, fileName: file.name }) === type);
    return folderListEntries([], ofType, settings);
  }, [allFiles, settings, type]);
  const files = useMemo(() => entries.flatMap((entry) => (entry.kind === 'file' ? [entry.file] : [])), [entries]);
  // F4: a long press selects; the selection bar acts on the selected files.
  const keys = useMemo(() => entries.map((entry) => entry.key), [entries]);
  const selection = useSelection(keys);
  const selectedEntries = useMemo<SelectedEntry[]>(
    () => entries.filter((entry) => selection.selected.has(entry.key)),
    [entries, selection.selected],
  );
  const { clear: clearSelection } = selection;
  const afterBatch = useCallback(() => {
    clearSelection();
    void reload();
  }, [clearSelection, reload]);

  const openFile = useOpenFile(files);
  const onRefresh = useCallback(() => void refresh(), [refresh]);
  const closeMenu = useCallback(() => setMenuFile(null), []);
  const onChanged = useCallback(() => void reload(), [reload]);

  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  const subtitle = [fileCountText(files.length, t), totalBytes > 0 ? formatFileBytes(totalBytes) : null].filter(Boolean).join(' · ');

  return (
    <DsScreen scroll={false} edges={['top', 'bottom']} testID="files-type-screen">
      <FileEntriesList
        entries={entries}
        header={
          <View style={{ paddingBottom: ds.space.stack }}>
            {selection.active ? (
              <SelectionHeader count={selection.count} onClose={selection.clear} onSelectAll={selection.selectAll} onInvert={selection.invert} />
            ) : (
              <DsHeader
                title={isTileType(type) ? t(tileLabelKey(type)) : t('filesTab.title')}
                subtitle={status === 'ready' ? subtitle : undefined}
                onBack={() => navigation.back()}
                action={settingsAction}
              />
            )}
          </View>
        }
        empty={
          status === 'loading' ? (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <ActivityIndicator color={theme.colors.primary} accessibilityLabel={t('common.loading')} />
            </View>
          ) : (
            <DsCard testID="files-type-empty">
              <View style={{ gap: 6, alignItems: 'center', paddingVertical: 8 }}>
                <DsText variant="bodyStrong" align="center">
                  {status === 'error' ? t('fileManager.loadFailed') : t('fileManager.typeEmpty')}
                </DsText>
                {status === 'error' ? null : (
                  <DsText variant="body" align="center">
                    {t('fileManager.typeEmptyHint')}
                  </DsText>
                )}
              </View>
            </DsCard>
          )
        }
        folderMeta={noFolderMeta}
        onPressFile={openFile}
        onMoreFile={setMenuFile}
        onPressFolder={noFolderPress}
        refreshing={refreshing}
        onRefresh={onRefresh}
        highlightId={highlightId}
        selection={selection}
        testID="files-type-list"
      />
      {selection.active ? <SelectionBar entries={selectedEntries} onDone={afterBatch} /> : null}
      <FileActionsSheet file={menuFile} onClose={closeMenu} onOpen={openFile} onChanged={onChanged} />
    </DsScreen>
  );
});
