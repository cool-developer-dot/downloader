import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, View, type ListRenderItem } from 'react-native';

import { ds, DsButton, DsCard, DsChip, DsChipRow, DsHeader, DsRow, DsScreen, DsText } from '@/design';
import type { FileEntry } from '@/files/api';
import { binIsOn, requestDelete } from '@/files/trash/useDeleteWithUndo';
import { CLEAN_OLDER_MONTHS, cleanCandidates, hasCleanRule, withWatchHistory, type CleanOlderMonths, type CleanRules } from '@/files/ui/clean-downloads';
import { fileBytes, fileLabel } from '@/files/ui/file-fields';
import { useTheme } from '@/hooks/use-theme';
import { intlLocaleForLanguage, useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import { buildPlaybackSummaryMap, listLocalPlaybackSummaries, useContinueWatchingQuery, useRecentPlaybackQuery } from '@/playback/hooks';

import { ListCardCell } from './components/ListCardCell';
import { useAllFiles } from './hooks/use-files-data';
import { useFilesSettingsAction } from './hooks/use-files-settings-action';
import { fileMetaLine, fileTypeIcon, formatFileBytes } from './utils/file-rows';

/**
 * Files F9 · #856 Clean downloads (`/files/clean-downloads`): pick downloads to clear by rule — watched to the end
 * (from watch history), older than 3, 6 or 12 months, larger than 500 MB — see exactly which ones first, then move
 * them to the Recycle bin (through the one delete door; with the bin off it says "Delete" and asks "forever").
 * Private and missing files are never picked.
 */
export const CleanDownloadsScreen = memo(function CleanDownloadsScreen() {
  const theme = useTheme();
  const { t, language } = useTranslation();
  const locale = intlLocaleForLanguage(language);
  const settingsAction = useFilesSettingsAction();
  const { data: files, status, reload } = useAllFiles();
  const [rules, setRules] = useState<CleanRules>({});
  const [now] = useState(() => Date.now());
  // Watch history, gathered as the Player tab gathers it ("watched to the end" lives there, not on the list).
  const continueQuery = useContinueWatchingQuery();
  const recentQuery = useRecentPlaybackQuery(50);
  const playbackById = useMemo(
    () => buildPlaybackSummaryMap([...recentQuery.items, ...continueQuery.items, ...listLocalPlaybackSummaries()]),
    [continueQuery.items, recentQuery.items],
  );
  const watchedFiles = useMemo(() => withWatchHistory(files, playbackById), [files, playbackById]);

  const picked = useMemo(() => cleanCandidates(watchedFiles, rules, { now }), [now, rules, watchedFiles]);
  const totalBytes = picked.reduce((sum, file) => sum + fileBytes(file), 0);
  const toBin = binIsOn();

  const setOlder = useCallback((months: CleanOlderMonths) => {
    setRules((current) => ({ ...current, olderThanMonths: current.olderThanMonths === months ? null : months }));
  }, []);

  const renderFile = useCallback<ListRenderItem<FileEntry>>(
    ({ item, index }) => (
      <ListCardCell first={index === 0} last={index === picked.length - 1}>
        <DsRow icon={fileTypeIcon(item.fileType)} title={fileLabel(item)} subtitle={fileMetaLine(item, locale)} trailing="none" testID={`files-clean-${item.id}`} />
      </ListCardCell>
    ),
    [locale, picked.length],
  );

  return (
    <DsScreen scroll={false} edges={['top', 'bottom']} testID="files-clean-screen">
      <FlatList
        data={picked}
        keyExtractor={(file) => file.id}
        renderItem={renderFile}
        ListHeaderComponent={
          <View style={{ gap: ds.space.stack, paddingBottom: ds.space.stack }}>
            <DsHeader
              title={t('fileManager.cleanDownloads')}
              subtitle={t('fileManager.cleanDownloadsHint')}
              onBack={() => navigation.back()}
              action={settingsAction}
            />
            <DsChipRow>
              <DsChip
                label={t('fileManager.cleanWatched')}
                selected={rules.watched === true}
                onPress={() => setRules((current) => ({ ...current, watched: !current.watched }))}
                testID="files-clean-watched"
              />
              {CLEAN_OLDER_MONTHS.map((months) => (
                <DsChip
                  key={months}
                  label={t('fileManager.cleanOlder', { months })}
                  selected={rules.olderThanMonths === months}
                  onPress={() => setOlder(months)}
                  testID={`files-clean-older-${months}`}
                />
              ))}
              <DsChip
                label={t('fileManager.cleanLarger')}
                selected={rules.larger === true}
                onPress={() => setRules((current) => ({ ...current, larger: !current.larger }))}
                testID="files-clean-larger"
              />
            </DsChipRow>
            {hasCleanRule(rules) && picked.length > 0 ? (
              <DsText variant="bodyStrong" testID="files-clean-summary">
                {picked.length === 1
                  ? t('fileManager.cleanPreviewOne', { size: formatFileBytes(totalBytes) ?? '0 B' })
                  : t('fileManager.cleanPreviewOther', { count: picked.length, size: formatFileBytes(totalBytes) ?? '0 B' })}
              </DsText>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          status === 'loading' ? (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <ActivityIndicator color={theme.colors.primary} accessibilityLabel={t('common.loading')} />
            </View>
          ) : (
            <DsCard testID="files-clean-empty">
              <DsText variant="body" align="center">
                {hasCleanRule(rules) ? t('fileManager.cleanNone') : t('fileManager.cleanPickRule')}
              </DsText>
            </DsCard>
          )
        }
        ListFooterComponent={
          picked.length > 0 ? (
            <View style={{ paddingTop: ds.space.stack }}>
              <DsButton
                label={toBin ? t('fileManager.cleanMoveToBin', { count: picked.length }) : t('fileManager.cleanDeleteForever', { count: picked.length })}
                onPress={() => requestDelete({ ids: picked.map((file) => file.id), source: 'batch', onDone: () => void reload() })}
                fullWidth
                testID="files-clean-apply"
              />
            </View>
          ) : null
        }
        contentContainerStyle={{ paddingHorizontal: ds.space.screenX, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        testID="files-clean-list"
      />
    </DsScreen>
  );
});
