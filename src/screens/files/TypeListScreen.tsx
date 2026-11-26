import { useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ds, DsCard, DsHeader, DsScreen, DsText } from '@/design';
import { fileBytes } from '@/files/ui/file-fields';
import type { FileEntry } from '@/files/ui/files-source';
import { useFilesViewSettings } from '@/files/ui/files-view-settings';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';

import { FileEntriesList } from './components/FileEntriesList';
import { FileMenu } from './components/FileMenu';
import { useAllFiles } from './hooks/use-files-data';
import { useFilesSettingsAction } from './hooks/use-files-settings-action';
import { useOpenFile } from './hooks/use-open-file';
import { fileCountText, folderListEntries, formatFileBytes } from './utils/file-rows';
import { isTileType, tileFiles, tileLabelKey } from './utils/type-tiles';

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
  const type = paramOf(useLocalSearchParams<{ type?: string | string[] }>().type);
  const { data: allFiles, status, refreshing, refresh, reload } = useAllFiles();
  const settings = useFilesViewSettings();
  const settingsAction = useFilesSettingsAction();
  const [menuFile, setMenuFile] = useState<FileEntry | null>(null);

  const entries = useMemo(() => {
    if (!isTileType(type)) {
      return [];
    }
    const ofType = tileFiles(allFiles, type);
    return folderListEntries([], ofType, settings);
  }, [allFiles, settings, type]);
  const files = useMemo(() => entries.flatMap((entry) => (entry.kind === 'file' ? [entry.file] : [])), [entries]);

  const openFile = useOpenFile(files);
  const onRefresh = useCallback(() => void refresh(), [refresh]);
  const closeMenu = useCallback(() => setMenuFile(null), []);
  const onChanged = useCallback(() => void reload(), [reload]);

  const totalBytes = files.reduce((sum, file) => sum + fileBytes(file), 0);
  const subtitle = [fileCountText(files.length, t), totalBytes > 0 ? formatFileBytes(totalBytes) : null].filter(Boolean).join(' · ');

  return (
    <DsScreen scroll={false} edges={['top', 'bottom']} testID="files-type-screen">
      <FileEntriesList
        entries={entries}
        header={
          <View style={{ paddingBottom: ds.space.stack }}>
            <DsHeader
              title={isTileType(type) ? t(tileLabelKey(type)) : t('filesTab.title')}
              subtitle={status === 'ready' ? subtitle : undefined}
              onBack={() => navigation.back()}
              action={settingsAction}
            />
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
        testID="files-type-list"
      />
      <FileMenu file={menuFile} onClose={closeMenu} onOpen={openFile} onChanged={onChanged} />
    </DsScreen>
  );
});
