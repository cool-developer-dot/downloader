import { useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View, type ListRenderItem } from 'react-native';

import { ds, DsCard, DsHeader, DsScreen, DsText } from '@/design';
import type { FileEntry } from '@/files/ui/files-source';
import { useTheme } from '@/hooks/use-theme';
import { intlLocaleForLanguage, useTranslation } from '@/localization';
import { navigation } from '@/navigation';

import { FileMenu } from './components/FileMenu';
import { FileRow } from './components/FileRow';
import { useAllFiles } from './hooks/use-files-data';
import { useOpenFile } from './hooks/use-open-file';
import { fileCountText, fileMetaLine, folderListEntries, formatFileBytes } from './utils/file-rows';
import { isTileType, tileFiles, tileLabelKey } from './utils/type-tiles';

function paramOf(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/**
 * Files F1 · #753 Categories: one type tile's files (`/files/type/[type]`) — exactly the library files `fileTypeOf()`
 * gives that type, from every folder. A tap opens the file; ⋮ opens its menu.
 */
export const TypeListScreen = memo(function TypeListScreen() {
  const theme = useTheme();
  const { t, language } = useTranslation();
  const type = paramOf(useLocalSearchParams<{ type?: string | string[] }>().type);
  const { data: allFiles, status, refreshing, refresh, reload } = useAllFiles();
  const [menuFile, setMenuFile] = useState<FileEntry | null>(null);
  const locale = intlLocaleForLanguage(language);

  const files = useMemo(() => {
    if (!isTileType(type)) {
      return [];
    }
    const ofType = tileFiles(allFiles, type);
    return folderListEntries([], ofType, { foldersFirst: true }).flatMap((entry) => (entry.kind === 'file' ? [entry.file] : []));
  }, [allFiles, type]);

  const openFile = useOpenFile(files);
  const onRefresh = useCallback(() => void refresh(), [refresh]);
  const closeMenu = useCallback(() => setMenuFile(null), []);
  const onChanged = useCallback(() => void reload(), [reload]);

  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  const subtitle = [fileCountText(files.length, t), totalBytes > 0 ? formatFileBytes(totalBytes) : null].filter(Boolean).join(' · ');

  const renderFile = useCallback<ListRenderItem<FileEntry>>(
    ({ item, index }) => (
      <FileRow
        file={item}
        name={item.name}
        meta={fileMetaLine(item, locale)}
        first={index === 0}
        last={index === files.length - 1}
        onPress={openFile}
        onMore={setMenuFile}
        testID={`files-type-row-${item.id}`}
      />
    ),
    [files.length, locale, openFile],
  );

  return (
    <DsScreen scroll={false} edges={['top', 'bottom']} testID="files-type-screen">
      <FlatList
        data={files}
        keyExtractor={(file) => file.id}
        renderItem={renderFile}
        ListHeaderComponent={
          <View style={{ paddingBottom: ds.space.stack }}>
            <DsHeader
              title={isTileType(type) ? t(tileLabelKey(type)) : t('filesTab.title')}
              subtitle={status === 'ready' ? subtitle : undefined}
              onBack={() => navigation.back()}
            />
          </View>
        }
        ListEmptyComponent={
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
        testID="files-type-list"
      />
      <FileMenu file={menuFile} onClose={closeMenu} onOpen={openFile} onChanged={onChanged} />
    </DsScreen>
  );
});
