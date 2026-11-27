import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { TextField } from '@/components/inputs/TextField';
import { AppModal } from '@/components/modals/AppModal';
import { ds, DsButton, DsCard, DsChip, DsChipRow, DsHeader, DsScreen, DsSearchField, DsText } from '@/design';
import { fileBytes, fileLabel } from '@/files/ui/file-fields';
import { FILE_TYPES, type FileType } from '@/files/ui/file-types';
import { hiddenFolderIds, useLockedNowIds } from '@/files/ui/locked-folders';
import { subscribeFiles, type FileEntry, type FolderEntry } from '@/files/ui/files-source';
import { inSelectionOrder } from '@/files/ui/selection';
import { useSelection } from '@/files/ui/use-selection';
import {
  DATE_RANGES,
  DEFAULT_OLD_MONTHS,
  extensionsPresent,
  hasFilters,
  OLD_MONTHS,
  SEARCH_SORTS,
  searchFiles,
  SIZE_BUCKETS,
  type DateRange,
  type OldMonths,
  type SearchFilters,
  type SearchItem,
  type SearchSort,
  type SizeBucket,
} from '@/files/search/files-search';
import { searchStateFromParams } from '@/files/search/search-params';
import { useItemHiddenStore, useItemNotesStore, useItemTagsStore, useTagColorsStore } from '@/library/item-organize-store';
import { SWATCH_IDS, type SwatchId } from '@/files/organize/swatches';
import { colorsOfTags } from '@/files/organize/tag-colors';
import { withoutHiddenItems } from '@/files/organize/hidden-items';
import { useFilesViewSettings } from '@/files/ui/files-view-settings';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';
import { navigation } from '@/navigation';
import { ChoiceSheet, type ChoiceOption } from '@/screens/settings/browser-settings/ChoiceSheet';

import { FileEntriesList } from './components/FileEntriesList';
import { SWATCH_LABELS } from './components/SwatchPicker';
import { SelectionBar, type SelectedEntry } from './components/SelectionBar';
import { SelectionHeader } from './components/SelectionHeader';
import { FileActionsSheet } from './FileActionsSheet';
import { listAllFilesAndFolders } from './hooks/use-files-data';
import { useFilesSettingsAction } from './hooks/use-files-settings-action';
import { useOpenFile } from './hooks/use-open-file';
import { useSelectionMoreActions } from './hooks/use-selection-more';
import { fileEntryOf, type FolderListEntry } from './utils/file-rows';
import { tileLabelKey, type TileType } from './utils/type-tiles';

/** Typing settles for this long before the results change (#807). */
const SEARCH_DEBOUNCE_MS = 150;

type Sheet = 'type' | 'size' | 'date' | 'extension' | 'old' | 'sort' | 'color' | null;
type Hit = SearchItem & { file: FileEntry };

const SIZE_LABELS: Record<SizeBucket, TranslationKey> = {
  'under-10mb': 'fileManager.sizeUnder10',
  '10-100mb': 'fileManager.size10to100',
  '100mb-1gb': 'fileManager.size100to1g',
  'over-1gb': 'fileManager.sizeOver1g',
};
const DATE_LABELS: Record<(typeof DATE_RANGES)[number], TranslationKey> = {
  today: 'fileManager.dateToday',
  '7-days': 'fileManager.date7',
  '30-days': 'fileManager.date30',
  'this-year': 'fileManager.dateYear',
};
const SORT_LABELS: Record<SearchSort, TranslationKey> = {
  best: 'fileManager.sortBest',
  name: 'fileManager.sortName',
  date: 'fileManager.sortDate',
  size: 'fileManager.sortSize',
};

/**
 * Files F6 · search, filters and sort (`/files/search`, the Files tab's 🔍): a focused field (results settle 150 ms
 * after typing), the chips Type, Size, Date, Extension, Old, Recent and Sort, the result count, and the results as
 * file rows with the matched part of the name in bold. It searches names, folder names, tags and notes; files in a
 * locked folder never match, and Private files are not in Files at all. F4's selection works on the results. With no
 * result: "No files match", and Clear filters while a filter is on.
 */
export const FilesSearchScreen = memo(function FilesSearchScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const settingsAction = useFilesSettingsAction();
  const lockedNow = useLockedNowIds();
  const tagsById = useItemTagsStore((s) => s.tagsById);
  const notesById = useItemNotesStore((s) => s.notesById);
  const tagColors = useTagColorsStore((s) => s.colors);
  // F7 #911: hidden files stay out of search until Show hidden files is on.
  const hiddenIds = useItemHiddenStore((s) => s.hiddenIds);
  const { showHidden } = useFilesViewSettings();
  /** The files, their folders, and when they were read (the "now" of the date filters). */
  const [data, setData] = useState<{ files: FileEntry[]; folders: FolderEntry[]; now: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  // F9: a link from the Storage page opens the search with its filters and sort set.
  const linkParams = useLocalSearchParams<{ types?: string; minMb?: string; old?: string; sort?: string }>();
  const [linked] = useState(() => searchStateFromParams(linkParams));
  const [filters, setFilters] = useState<SearchFilters>(linked.filters);
  const [sort, setSort] = useState<SearchSort>(linked.sort ?? 'best');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [menuFile, setMenuFile] = useState<FileEntry | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const now = data?.now ?? 0;

  const load = useCallback(async () => {
    const next = await listAllFilesAndFolders({ includeHidden: showHidden }).catch(() => ({ files: [] as FileEntry[], folders: [] as FolderEntry[] }));
    setData({ ...next, now: Date.now() });
  }, [showHidden]);
  // On focus, and again whenever the files change while the search is in front (no polling).
  useFocusEffect(
    useCallback(() => {
      void load();
      return subscribeFiles(() => {
        void load();
      });
    }, [load]),
  );
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const onChangeText = useCallback((value: string) => {
    setDraft(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setQuery(value), SEARCH_DEBOUNCE_MS);
  }, []);

  const items = useMemo<Hit[]>(() => {
    if (!data) return [];
    const folderNames = new Map(data.folders.map((folder) => [folder.id, folder.name] as const));
    return withoutHiddenItems(data.files, new Set(hiddenIds), showHidden).map((file) => ({
      id: file.id,
      name: fileLabel(file),
      type: file.fileType,
      sizeBytes: fileBytes(file),
      date: file.downloadedAt,
      folderId: file.folderId,
      folderName: file.folderId ? (folderNames.get(file.folderId) ?? null) : null,
      tags: tagsById[file.id] ?? [],
      tagColors: colorsOfTags(tagColors, tagsById[file.id] ?? []),
      note: notesById[file.id] ?? null,
      file,
    }));
  }, [data, hiddenIds, notesById, showHidden, tagColors, tagsById]);

  const hidden = useMemo(() => hiddenFolderIds(lockedNow, data?.folders ?? []), [data, lockedNow]);
  const hits = useMemo(
    () => searchFiles(items, { query, filters, sort, hiddenFolderIds: hidden, now }),
    [filters, hidden, items, now, query, sort],
  );
  const entries = useMemo<FolderListEntry[]>(() => hits.map((hit) => fileEntryOf(hit.item.file)), [hits]);
  const matchById = useMemo(() => new Map(hits.map((hit) => [hit.item.id, hit.nameMatch] as const)), [hits]);
  const nameMatchOf = useCallback((file: FileEntry) => matchById.get(file.id) ?? null, [matchById]);
  const extensions = useMemo(() => extensionsPresent(items), [items]);
  const filtersOn = hasFilters(filters);

  const files = useMemo(() => hits.map((hit) => hit.item.file), [hits]);
  const openFile = useOpenFile(files);
  const keys = useMemo(() => entries.map((entry) => entry.key), [entries]);
  const selection = useSelection(keys);
  const selectedEntries = useMemo<SelectedEntry[]>(() => inSelectionOrder(entries, selection.selected), [entries, selection.selected]);
  const { clear: clearSelection } = selection;
  // F5 + F6: the search results' More ⋮ (Rename; F7 adds Tag, Color and Hide).
  const moreActions = useSelectionMoreActions();
  const afterChange = useCallback(() => {
    clearSelection();
    void load();
  }, [clearSelection, load]);

  const patch = useCallback((next: Partial<SearchFilters>) => setFilters((current) => ({ ...current, ...next })), []);
  const closeSheet = useCallback(() => setSheet(null), []);

  // Each chip's sheet: "any" (or off) first, then its choices.
  const typeOptions = useMemo<ChoiceOption<string>[]>(
    () => [{ value: 'any', label: t('fileManager.anyType') }, ...FILE_TYPES.filter((type) => type !== 'other').map((type) => ({ value: type, label: t(tileLabelKey(type as TileType)) }))],
    [t],
  );
  const sizeOptions = useMemo<ChoiceOption<string>[]>(
    () => [{ value: 'any', label: t('fileManager.anySize') }, ...SIZE_BUCKETS.map((bucket) => ({ value: bucket, label: t(SIZE_LABELS[bucket]) }))],
    [t],
  );
  const dateOptions = useMemo<ChoiceOption<string>[]>(
    () => [
      { value: 'any', label: t('fileManager.anyTime') },
      ...DATE_RANGES.map((range) => ({ value: range, label: t(DATE_LABELS[range]) })),
      { value: 'custom', label: t('fileManager.dateCustom') },
    ],
    [t],
  );
  const extensionOptions = useMemo<ChoiceOption<string>[]>(
    () => [{ value: 'any', label: t('fileManager.anyExtension') }, ...extensions.map((extension) => ({ value: extension, label: `.${extension}` }))],
    [extensions, t],
  );
  const oldOptions = useMemo<ChoiceOption<string>[]>(
    () => [{ value: 'off', label: t('fileManager.oldOff') }, ...OLD_MONTHS.map((months) => ({ value: String(months), label: t('fileManager.oldMonths', { months }) }))],
    [t],
  );
  const sortOptions = useMemo<ChoiceOption<SearchSort>[]>(() => SEARCH_SORTS.map((value) => ({ value, label: t(SORT_LABELS[value]) })), [t]);
  // F7 #977: filter by a tag's colour.
  const colorOptions = useMemo<ChoiceOption<string>[]>(
    () => [{ value: 'any', label: t('fileManager.anyColor') }, ...SWATCH_IDS.map((id) => ({ value: id, label: t(SWATCH_LABELS[id]) }))],
    [t],
  );

  const dateLabel = (range: DateRange) =>
    typeof range === 'object' ? t('fileManager.dateCustomValue', { from: range.from.slice(0, 10), to: range.to.slice(0, 10) }) : t(DATE_LABELS[range]);
  const chip = (label: TranslationKey, value: string | null, onPress: () => void, testID: string, selected = value !== null) => (
    <DsChip
      key={testID}
      label={value ? t('fileManager.chipValue', { chip: t(label), value }) : t(label)}
      selected={selected}
      onPress={onPress}
      testID={testID}
    />
  );

  const header = (
    <View style={{ gap: ds.space.stack, paddingBottom: ds.space.stack }}>
      {selection.active ? (
        <SelectionHeader count={selection.count} onClose={selection.clear} onSelectAll={selection.selectAll} onInvert={selection.invert} />
      ) : (
        <DsHeader title={t('filesTab.searchA11y')} onBack={() => navigation.back()} action={settingsAction} />
      )}
      <DsSearchField
        value={draft}
        onChangeText={onChangeText}
        placeholder={t('fileManager.searchPlaceholder')}
        autoFocus
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel={t('filesTab.searchA11y')}
        actions={draft ? [{ icon: 'x', accessibilityLabel: t('common.clearInput'), onPress: () => onChangeText('') }] : undefined}
        testID="files-search-field"
      />
      <DsChipRow>
        {filters.minBytes ? (
          <DsChip label={t('fileManager.filterOver100')} selected onPress={() => patch({ minBytes: null })} testID="files-search-chip-min-size" />
        ) : null}
        {chip('fileManager.chipType', filters.types?.[0] ? t(tileLabelKey(filters.types[0] as TileType)) : null, () => setSheet('type'), 'files-search-chip-type')}
        {chip('fileManager.chipSize', filters.size ? t(SIZE_LABELS[filters.size]) : null, () => setSheet('size'), 'files-search-chip-size')}
        {chip('fileManager.chipDate', filters.date ? dateLabel(filters.date) : null, () => setSheet('date'), 'files-search-chip-date')}
        {chip('fileManager.chipExtension', filters.extension ? `.${filters.extension}` : null, () => setSheet('extension'), 'files-search-chip-extension')}
        {chip(
          'fileManager.chipOld',
          filters.oldMonths ? t('fileManager.oldMonths', { months: filters.oldMonths }) : null,
          // #823: on at 6 months; a second tap picks 3, 6 or 12 months, or turns it off.
          () => (filters.oldMonths ? setSheet('old') : patch({ oldMonths: DEFAULT_OLD_MONTHS })),
          'files-search-chip-old',
        )}
        {chip('fileManager.chipRecent', null, () => patch({ recent: !filters.recent }), 'files-search-chip-recent', filters.recent === true)}
        {chip('fileManager.chipColor', filters.tagColor ? t(SWATCH_LABELS[filters.tagColor as SwatchId]) : null, () => setSheet('color'), 'files-search-chip-color')}
        {chip('fileManager.chipSort', t(SORT_LABELS[sort]), () => setSheet('sort'), 'files-search-chip-sort', sort !== 'best')}
      </DsChipRow>
      {data ? (
        <DsText variant="rowSub" accessibilityLiveRegion="polite" testID="files-search-count">
          {hits.length === 1 ? t('fileManager.resultsOne') : t('fileManager.resultsOther', { count: hits.length })}
        </DsText>
      ) : null}
    </View>
  );

  const empty = !data ? (
    <ActivityIndicator color={theme.colors.primary} accessibilityLabel={t('common.loading')} />
  ) : (
    <DsCard testID="files-search-empty">
      <View style={{ gap: 10, alignItems: 'center', paddingVertical: 8 }}>
        <DsText variant="bodyStrong" align="center">
          {t('fileManager.noMatch')}
        </DsText>
        {filtersOn ? <DsButton label={t('fileManager.clearFilters')} variant="secondary" onPress={() => setFilters({})} testID="files-search-clear" /> : null}
      </View>
    </DsCard>
  );

  return (
    <DsScreen scroll={false} edges={['top', 'bottom']} testID="files-search-screen">
      <FileEntriesList
        entries={entries}
        header={header}
        empty={empty}
        folderMeta={() => ''}
        onPressFile={openFile}
        onMoreFile={setMenuFile}
        onPressFolder={() => undefined}
        refreshing={false}
        onRefresh={() => void load()}
        selection={selection}
        nameMatchOf={nameMatchOf}
        testID="files-search-results"
      />
      {selection.active ? <SelectionBar entries={selectedEntries} onDone={afterChange} moreActions={moreActions} /> : null}
      <FileActionsSheet file={menuFile} onClose={() => setMenuFile(null)} onOpen={openFile} onChanged={afterChange} />

      <ChoiceSheet
        visible={sheet === 'type'}
        title={t('fileManager.chipType')}
        options={typeOptions}
        value={filters.types?.[0] ?? 'any'}
        onSelect={(value) => {
          patch({ types: value === 'any' ? [] : [value as FileType] });
          closeSheet();
        }}
        onClose={closeSheet}
      />
      <ChoiceSheet
        visible={sheet === 'size'}
        title={t('fileManager.chipSize')}
        options={sizeOptions}
        value={filters.size ?? 'any'}
        onSelect={(value) => {
          patch({ size: value === 'any' ? null : (value as SizeBucket) });
          closeSheet();
        }}
        onClose={closeSheet}
      />
      <ChoiceSheet
        visible={sheet === 'date'}
        title={t('fileManager.chipDate')}
        options={dateOptions}
        value={!filters.date ? 'any' : typeof filters.date === 'object' ? 'custom' : filters.date}
        onSelect={(value) => {
          closeSheet();
          if (value === 'custom') {
            setCustomOpen(true);
            return;
          }
          patch({ date: value === 'any' ? null : (value as DateRange) });
        }}
        onClose={closeSheet}
      />
      <ChoiceSheet
        visible={sheet === 'extension'}
        title={t('fileManager.chipExtension')}
        options={extensionOptions}
        value={filters.extension ?? 'any'}
        onSelect={(value) => {
          patch({ extension: value === 'any' ? null : value });
          closeSheet();
        }}
        onClose={closeSheet}
      />
      <ChoiceSheet
        visible={sheet === 'old'}
        title={t('fileManager.chipOld')}
        options={oldOptions}
        value={filters.oldMonths ? String(filters.oldMonths) : 'off'}
        onSelect={(value) => {
          patch({ oldMonths: value === 'off' ? null : (Number(value) as OldMonths) });
          closeSheet();
        }}
        onClose={closeSheet}
      />
      <ChoiceSheet
        visible={sheet === 'color'}
        title={t('fileManager.chipColor')}
        options={colorOptions}
        value={filters.tagColor ?? 'any'}
        onSelect={(value) => {
          patch({ tagColor: value === 'any' ? null : value });
          closeSheet();
        }}
        onClose={closeSheet}
      />
      <ChoiceSheet
        visible={sheet === 'sort'}
        title={t('fileManager.chipSort')}
        options={sortOptions}
        value={sort}
        onSelect={(value) => {
          setSort(value);
          closeSheet();
        }}
        onClose={closeSheet}
      />
      <AppModal visible={customOpen} onClose={() => setCustomOpen(false)} title={t('fileManager.dateCustom')} showCloseButton>
        <View style={{ gap: 10 }}>
          <TextField label={t('fileManager.dateFrom')} value={customFrom} onChangeText={setCustomFrom} keyboardType="numbers-and-punctuation" />
          <TextField label={t('fileManager.dateTo')} value={customTo} onChangeText={setCustomTo} keyboardType="numbers-and-punctuation" />
          <DsButton
            label={t('fileManager.dateApply')}
            disabled={!/^\d{4}-\d{2}-\d{2}$/.test(customFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(customTo)}
            onPress={() => {
              patch({ date: { from: `${customFrom}T00:00:00`, to: `${customTo}T00:00:00` } });
              setCustomOpen(false);
            }}
            fullWidth
          />
        </View>
      </AppModal>
    </DsScreen>
  );
});
