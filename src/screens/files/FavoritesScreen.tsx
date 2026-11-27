import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ds, DsCard, DsHeader, DsScreen, DsText } from '@/design';
import type { FileEntry } from '@/files/ui/files-source';
import { useFilesViewSettings } from '@/files/ui/files-view-settings';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';

import { FileEntriesList } from './components/FileEntriesList';
import { FileActionsSheet } from './FileActionsSheet';
import { useAllFiles } from './hooks/use-files-data';
import { useFilesSettingsAction } from './hooks/use-files-settings-action';
import { useOpenFile } from './hooks/use-open-file';
import { fileCountText, folderListEntries } from './utils/file-rows';

/** Files F7 · #750 Favorites (`/files/favorites`): every favourite file (the library's own favourite flag). */
export const FavoritesScreen = memo(function FavoritesScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { data: allFiles, status, refreshing, refresh, reload } = useAllFiles();
  const settings = useFilesViewSettings();
  const settingsAction = useFilesSettingsAction();
  const [menuFile, setMenuFile] = useState<FileEntry | null>(null);

  const entries = useMemo(() => folderListEntries([], allFiles.filter((file) => file.favorite), settings), [allFiles, settings]);
  const files = useMemo(() => entries.flatMap((entry) => (entry.kind === 'file' ? [entry.file] : [])), [entries]);
  const openFile = useOpenFile(files);
  const onChanged = useCallback(() => void reload(), [reload]);

  return (
    <DsScreen scroll={false} edges={['top', 'bottom']} testID="files-favorites-screen">
      <FileEntriesList
        entries={entries}
        header={
          <View style={{ paddingBottom: ds.space.stack }}>
            <DsHeader
              title={t('fileManager.favoritesTitle')}
              subtitle={status === 'ready' ? fileCountText(files.length, t) : undefined}
              onBack={() => navigation.back()}
              action={settingsAction}
            />
          </View>
        }
        empty={
          status === 'loading' ? (
            <ActivityIndicator color={theme.colors.primary} accessibilityLabel={t('common.loading')} />
          ) : (
            <DsCard>
              <View style={{ gap: 6, alignItems: 'center', paddingVertical: 8 }}>
                <DsText variant="bodyStrong" align="center">
                  {t('fileManager.favoritesEmpty')}
                </DsText>
                <DsText variant="body" align="center">
                  {t('fileManager.favoritesEmptyHint')}
                </DsText>
              </View>
            </DsCard>
          )
        }
        folderMeta={() => ''}
        onPressFile={openFile}
        onMoreFile={setMenuFile}
        onPressFolder={() => undefined}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        testID="files-favorites-list"
      />
      <FileActionsSheet file={menuFile} onClose={() => setMenuFile(null)} onOpen={openFile} onChanged={onChanged} />
    </DsScreen>
  );
});
