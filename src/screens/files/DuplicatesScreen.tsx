import { useFocusEffect } from 'expo-router';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, View, type ListRenderItem } from 'react-native';

import { ds, DsButton, DsCard, DsHeader, DsIcon, DsRow, DsScreen, DsSectionLabel, DsText } from '@/design';
import type { FileEntry } from '@/files/api';
import { requestDelete } from '@/files/trash/useDeleteWithUndo';
import { duplicatesToDelete, initialDuplicateSelection, keptCopy, toggleDuplicate } from '@/files/ui/duplicates-view';
import { fileBytes, fileLabel } from '@/files/ui/file-fields';
import { findDuplicates } from '@/files/ui/cleanup-port';
import { intlLocaleForLanguage, useTranslation } from '@/localization';
import { navigation } from '@/navigation';

import { ListCardCell } from './components/ListCardCell';
import { useFilesSettingsAction } from './hooks/use-files-settings-action';
import { fileTypeIcon, formatFileBytes, formatFileDate } from './utils/file-rows';

type Group = Awaited<ReturnType<typeof findDuplicates>>[number];
type Row = { kind: 'group'; key: string; group: Group } | { kind: 'item'; key: string; group: Group; item: FileEntry; first: boolean; last: boolean };

/**
 * Files F9 · design 59 Duplicates (`/files/duplicates`): F14's groups of identical files, scanned with progress and a
 * Cancel. Each group keeps its newest copy and selects the others; "Delete selected" sends them to the Recycle bin and
 * never takes every copy of a group. Reached only while `filesCapabilities.duplicates` is true.
 */
export const DuplicatesScreen = memo(function DuplicatesScreen() {
  const { t, language } = useTranslation();
  const settingsAction = useFilesSettingsAction();
  const locale = intlLocaleForLanguage(language);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const scan = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setScanning(true);
    setProgress(null);
    void findDuplicates({ signal: controller.signal, onProgress: (done, total) => setProgress({ done, total }) })
      .then((found) => {
        if (controller.signal.aborted) return;
        const real = found.filter((group) => group.items.length > 1);
        setGroups(real);
        setSelected(initialDuplicateSelection(real));
      })
      .catch(() => undefined)
      .finally(() => {
        if (abortRef.current === controller) setScanning(false);
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      scan();
      return () => abortRef.current?.abort();
    }, [scan]),
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setScanning(false);
  }, []);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const group of groups) {
      out.push({ kind: 'group', key: `group:${group.hash}`, group });
      group.items.forEach((item, index) =>
        out.push({ kind: 'item', key: `item:${group.hash}:${item.id}`, group, item, first: index === 0, last: index === group.items.length - 1 }),
      );
    }
    return out;
  }, [groups]);

  const toDelete = useMemo(() => duplicatesToDelete(groups, selected), [groups, selected]);

  const renderRow = useCallback<ListRenderItem<Row>>(
    ({ item: row }) => {
      if (row.kind === 'group') {
        const first = row.group.items[0];
        return (
          <DsSectionLabel>
            {t('fileManager.duplicatesGroup', { count: row.group.items.length, size: formatFileBytes(first ? fileBytes(first) : 0) ?? '0 B' })}
          </DsSectionLabel>
        );
      }
      const on = selected.has(row.item.id);
      const kept = keptCopy(row.group) === row.item.id && !on;
      const when = formatFileDate(row.item.downloadedAt, locale) ?? '';
      return (
        <ListCardCell first={row.first} last={row.last}>
          <DsRow
            icon={fileTypeIcon(row.item.fileType)}
            title={fileLabel(row.item)}
            subtitle={kept ? `${when} · ${t('fileManager.duplicatesKept')}` : when}
            onPress={() => setSelected((current) => toggleDuplicate(current, row.group, row.item.id))}
            trailing={<DsIcon name={on ? 'square-check' : 'square'} size={22} color={on ? 'primary' : 'textSecondary'} strokeWidth={1.8} />}
            accessibilityLabel={t('fileManager.duplicatesRowA11y', {
              name: fileLabel(row.item),
              when,
              state: on ? t('fileManager.selected') : t('fileManager.notSelected'),
            })}
            testID={`files-duplicate-${row.item.id}`}
          />
        </ListCardCell>
      );
    },
    [locale, selected, t],
  );

  return (
    <DsScreen scroll={false} edges={['top', 'bottom']} testID="files-duplicates-screen">
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        extraData={selected}
        ListHeaderComponent={
          <View style={{ gap: ds.space.stack, paddingBottom: ds.space.stack }}>
            <DsHeader
              title={t('fileManager.storageDuplicates')}
              subtitle={t('fileManager.duplicatesHint')}
              onBack={() => navigation.back()}
              action={settingsAction}
            />
            {scanning ? (
              <DsCard testID="files-duplicates-progress">
                <View style={{ gap: 8 }}>
                  <DsText variant="body">
                    {t('fileManager.duplicatesScanning', { done: progress?.done ?? 0, total: progress?.total ?? 0 })}
                  </DsText>
                  <DsButton label={t('common.cancel')} variant="secondary" onPress={cancel} testID="files-duplicates-cancel" />
                </View>
              </DsCard>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          scanning ? null : (
            <DsCard testID="files-duplicates-none">
              <DsText variant="bodyStrong" align="center">
                {t('fileManager.duplicatesNone')}
              </DsText>
            </DsCard>
          )
        }
        ListFooterComponent={
          rows.length > 0 ? (
            <View style={{ paddingTop: ds.space.stack }}>
              <DsButton
                label={t('fileManager.duplicatesDelete', { count: toDelete.length })}
                onPress={() => requestDelete({ ids: toDelete, source: 'batch', onDone: () => scan() })}
                disabled={toDelete.length === 0}
                fullWidth
                testID="files-duplicates-delete"
              />
            </View>
          ) : null
        }
        contentContainerStyle={{ paddingHorizontal: ds.space.screenX, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        testID="files-duplicates-list"
      />
    </DsScreen>
  );
});
