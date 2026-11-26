import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, View, type ListRenderItem } from 'react-native';

import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { ds, DsButton, DsButtonRow, DsCard, DsHeader, DsIcon, DsRow, DsRowGroup, DsScreen, DsText } from '@/design';
import { binRowLabels, binSubtitleLabels, KEEP_DAYS_CHOICES, keepLabel, type KeepDays, type Label } from '@/files/ui/bin-labels';
import { setFilesViewSettings, useFilesViewSettings } from '@/files/ui/files-view-settings';
import { emptyBin, restoreFromBin, setBinSettings } from '@/files/ui/trash-port';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslateFn } from '@/localization';
import { navigation } from '@/navigation';
import { ChoiceSheet, type ChoiceOption } from '@/screens/settings/browser-settings/ChoiceSheet';

import { announce } from './announce';
import { ListCardCell } from './components/ListCardCell';
import { useFilesSettingsAction } from './hooks/use-files-settings-action';
import { useRecycleBin, type BinItem } from './hooks/use-recycle-bin';
import { fileTypeIcon } from './utils/file-rows';

function say(label: Label, t: TranslateFn): string {
  return t(label.key, label.params);
}

/** Keep deleted files' choices as sheet values ("forever" stands for "Until I empty it"). */
type KeepValue = '7' | '14' | '30' | '60' | 'forever';
const toValue = (days: KeepDays): KeepValue => (days === null ? 'forever' : (String(days) as KeepValue));
const toDays = (value: KeepValue): KeepDays => (value === 'forever' ? null : (Number(value) as KeepDays));

/**
 * Files F8 · design 58 Recycle bin (`/files/recycle-bin`): what was deleted, "Deleted 2 days ago · Deletes in 28 days",
 * a tap selects a row, Restore brings back the selected rows (all when none is), Empty bin asks first. Below: Keep
 * deleted files (7, 14, 30, 60 days or Until I empty it) and F2's Confirm before delete. Read through the F13
 * stand-in (`trash-port`) until it merges; the entries to this page show only while `filesCapabilities.recycleBin`.
 */
export const RecycleBinScreen = memo(function RecycleBinScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const settingsAction = useFilesSettingsAction();
  const viewSettings = useFilesViewSettings();
  const { items, settings, status, reload } = useRecycleBin();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [keepOpen, setKeepOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const now = Date.now();

  // A row that left the bin (restored, emptied or purged) drops out of the selection.
  const chosen = useMemo(() => items.filter((item) => selected.has(item.id)).map((item) => item.id), [items, selected]);
  const [itemsLabel, keepDaysLabel] = binSubtitleLabels(items.length, settings.keepDays);

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const restore = useCallback(async () => {
    const ids = chosen.length > 0 ? chosen : items.map((item) => item.id);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await restoreFromBin(ids);
      announce(ids.length === 1 ? t('fileManager.binRestoredOne') : t('fileManager.binRestoredOther', { count: ids.length }));
      setSelected(new Set());
    } catch {
      announce(t('fileManager.binFailed'));
    } finally {
      setBusy(false);
      void reload();
    }
  }, [chosen, items, reload, t]);

  const empty = useCallback(async () => {
    setBusy(true);
    try {
      await emptyBin();
      announce(t('fileManager.binEmptied'));
      setSelected(new Set());
    } catch {
      announce(t('fileManager.binFailed'));
    } finally {
      setBusy(false);
      setConfirmEmpty(false);
      void reload();
    }
  }, [reload, t]);

  const keepOptions = useMemo<ChoiceOption<KeepValue>[]>(
    () => KEEP_DAYS_CHOICES.map((days) => ({ value: toValue(days), label: say(keepLabel(days), t) })),
    [t],
  );

  const renderItem = useCallback<ListRenderItem<BinItem>>(
    ({ item, index }) => {
      const on = selected.has(item.id);
      const when = binRowLabels(item, now)
        .map((label) => say(label, t))
        .join(' · ');
      return (
        <ListCardCell first={index === 0} last={index === items.length - 1}>
          <DsRow
            icon={fileTypeIcon(item.fileType)}
            title={item.title}
            subtitle={when}
            onPress={() => toggle(item.id)}
            trailing={<DsIcon name={on ? 'square-check' : 'square'} size={22} color={on ? 'primary' : 'textSecondary'} strokeWidth={1.8} />}
            accessibilityLabel={t('fileManager.binRowA11y', {
              name: item.title,
              when,
              state: on ? t('fileManager.selected') : t('fileManager.notSelected'),
            })}
            accessibilityHint={t('fileManager.binSelectHint')}
            testID={`files-bin-row-${item.id}`}
          />
        </ListCardCell>
      );
    },
    [items.length, now, selected, t, toggle],
  );

  const footer = (
    <View style={{ gap: ds.space.stack, paddingTop: ds.space.stack }}>
      {items.length > 0 ? (
        <DsButtonRow>
          <DsButton
            label={chosen.length > 0 || items.length === 1 ? t('fileManager.binRestore') : t('fileManager.binRestoreAll')}
            onPress={() => void restore()}
            disabled={busy}
            testID="files-bin-restore"
          />
          <DsButton label={t('fileManager.binEmptyBin')} variant="secondary" onPress={() => setConfirmEmpty(true)} disabled={busy} testID="files-bin-empty" />
        </DsButtonRow>
      ) : null}
      <DsRowGroup>
        <DsRow
          icon="trash-2"
          title={t('fileManager.binKeepRow')}
          subtitle={keepDaysLabel ? say(keepDaysLabel, t) : undefined}
          onPress={() => setKeepOpen(true)}
          testID="files-bin-keep"
        />
        <DsRow
          icon="alert-triangle"
          title={t('fileManager.confirmDelete')}
          toggle={{
            value: viewSettings.confirmDelete,
            onValueChange: (on) => setFilesViewSettings({ confirmDelete: on }),
            accessibilityHint: t('fileManager.confirmDeleteHint'),
          }}
          testID="files-bin-confirm-delete"
        />
      </DsRowGroup>
    </View>
  );

  return (
    <DsScreen scroll={false} edges={['top', 'bottom']} testID="files-bin-screen">
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        extraData={selected}
        ListHeaderComponent={
          <View style={{ paddingBottom: ds.space.stack }}>
            <DsHeader
              title={t('fileManager.binTitle')}
              subtitle={`${say(itemsLabel, t)} · ${say(keepDaysLabel, t)}`}
              onBack={() => navigation.back()}
              action={settingsAction}
            />
          </View>
        }
        ListEmptyComponent={
          status === 'loading' ? (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <ActivityIndicator color={theme.colors.primary} accessibilityLabel={t('common.loading')} />
            </View>
          ) : (
            <DsCard testID="files-bin-empty-state">
              <View style={{ gap: 6, alignItems: 'center', paddingVertical: 8 }}>
                <DsText variant="bodyStrong" align="center">
                  {status === 'error' ? t('fileManager.binLoadFailed') : t('fileManager.binEmpty')}
                </DsText>
                {status === 'error' ? null : (
                  <DsText variant="body" align="center">
                    {t('fileManager.binEmptyHint')}
                  </DsText>
                )}
              </View>
            </DsCard>
          )
        }
        ListFooterComponent={footer}
        contentContainerStyle={{ paddingHorizontal: ds.space.screenX, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        testID="files-bin-list"
      />
      <ConfirmModal
        visible={confirmEmpty}
        variant="delete"
        title={items.length === 1 ? t('fileManager.binEmptyConfirmOne') : t('fileManager.binEmptyConfirmOther', { count: items.length })}
        message={t('fileManager.binCantUndo')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={busy}
        onConfirm={() => void empty()}
        onCancel={() => {
          if (!busy) setConfirmEmpty(false);
        }}
        testID="files-bin-empty-confirm"
      />
      <ChoiceSheet
        visible={keepOpen}
        title={t('fileManager.binKeepRow')}
        options={keepOptions}
        value={toValue(settings.keepDays)}
        onSelect={(value) => {
          setBinSettings({ keepDays: toDays(value) });
          setKeepOpen(false);
          void reload();
        }}
        onClose={() => setKeepOpen(false)}
        testID="files-bin-keep-sheet"
      />
    </DsScreen>
  );
});
