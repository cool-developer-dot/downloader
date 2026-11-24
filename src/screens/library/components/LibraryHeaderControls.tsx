import { memo, useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { DsChip, DsChipRow, DsIconButton, DsSearchField } from '@/design';
import type { LibraryFilter, LibrarySort, LibraryViewMode } from '@/library';
import { DURATION_BUCKETS, type DurationBucket } from '@/library/duration-buckets';
import { useRtl, useTranslation, type TranslationKey } from '@/localization';
import { PlayerTagFilterChip } from '@/screens/downloads/components/OrganizeFilterChips';

import { LIBRARY_SORT_OPTIONS } from '../constants/library.constants';
import type { LibraryKind } from '../utils/library-kind';

const SORT_LABEL_KEYS: Record<LibrarySort, TranslationKey> = {
  newest: 'library.sortNewest',
  oldest: 'library.sortOldest',
  name_asc: 'library.sortNameAsc',
  name_desc: 'library.sortNameDesc',
  largest: 'library.sortLargest',
  smallest: 'library.sortSmallest',
  recently_played: 'library.sortRecentlyPlayed',
  most_played: 'libraryStats.sortMostPlayed',
};

/** P9 #711: the length filter's choices. */
const DURATION_LABEL_KEYS: Record<DurationBucket, TranslationKey> = {
  any: 'libraryStats.durationAny',
  under5: 'libraryStats.durationUnder5',
  from5to20: 'libraryStats.duration5to20',
  from20to60: 'libraryStats.duration20to60',
  over60: 'libraryStats.durationOver60',
};

/** Design 18's second chips (after its All · Folders · Recent · Most played come the filters the Player tab had). */
const FILTER_CHIPS: readonly { id: LibraryFilter; label: TranslationKey }[] = [
  { id: 'all', label: 'playerDesign.chipAll' },
  { id: 'folder', label: 'playerDesign.chipFolders' },
  { id: 'recently_watched', label: 'playerDesign.chipRecent' },
];
const MORE_FILTER_CHIPS: readonly { id: LibraryFilter; label: TranslationKey }[] = [
  { id: 'favorites', label: 'playerDesign.chipFavorites' },
  { id: 'recently_downloaded', label: 'playerDesign.chipNew' },
];

export type LibraryHeaderControlsProps = {
  /** Design 18's first chips: Videos · Audio (the list), Playlists · Network (other screens). */
  kind: LibraryKind;
  onSelectKind: (kind: LibraryKind) => void;
  onOpenPlaylists: () => void;
  onOpenNetwork: () => void;
  searchDraft: string;
  filter: LibraryFilter;
  sort: LibrarySort;
  viewMode: LibraryViewMode;
  quality: string | null;
  qualities: string[];
  controlsDirty: boolean;
  sortSheetVisible: boolean;
  qualitySheetVisible: boolean;
  onChangeSearch: (value: string) => void;
  onOpenSort: () => void;
  onCloseSort: () => void;
  onOpenQuality: () => void;
  onCloseQuality: () => void;
  onSelectFilter: (filter: LibraryFilter) => void;
  onSelectSort: (sort: LibrarySort) => void;
  onSelectQuality: (quality: string | null) => void;
  onToggleViewMode: () => void;
  onReset: () => void;
  testID?: string;
  /** P9 #711: the length filter (a chip and its sheet); omitted: no chip. */
  durationBucket?: DurationBucket;
  onSelectDuration?: (bucket: DurationBucket) => void;
};

/**
 * The Player tab's controls as design 18 draws them: Videos · Audio · Playlists · Network (with the search button at
 * that row's end), then All · Folders · Recent · Most played, scrolling on to the Player tab's other filters
 * (Favorites, Newly downloaded, Quality, Length, Tag) and Sort, whose sheet also switches grid / list and resets.
 */
export const LibraryHeaderControls = memo(function LibraryHeaderControls({
  kind,
  onSelectKind,
  onOpenPlaylists,
  onOpenNetwork,
  searchDraft,
  filter,
  sort,
  viewMode,
  quality,
  qualities,
  controlsDirty,
  sortSheetVisible,
  qualitySheetVisible,
  onChangeSearch,
  onOpenSort,
  onCloseSort,
  onOpenQuality,
  onCloseQuality,
  onSelectFilter,
  onSelectSort,
  onSelectQuality,
  onToggleViewMode,
  onReset,
  testID = 'library-controls',
  durationBucket = 'any',
  onSelectDuration,
}: LibraryHeaderControlsProps) {
  const { t } = useTranslation();
  const rtl = useRtl();
  const [durationSheetVisible, setDurationSheetVisible] = useState(false);
  const [searchOpen, setSearchOpen] = useState(Boolean(searchDraft.trim()));
  const searchVisible = searchOpen || Boolean(searchDraft.trim());

  const toggleSearch = useCallback(() => {
    if (searchVisible) {
      if (searchDraft) {
        onChangeSearch('');
      }
      setSearchOpen(false);
      return;
    }
    setSearchOpen(true);
  }, [onChangeSearch, searchDraft, searchVisible]);

  // A filter chip tapped again goes back to All.
  const pickFilter = useCallback(
    (next: LibraryFilter) => onSelectFilter(filter === next && next !== 'folder' ? 'all' : next),
    [filter, onSelectFilter],
  );
  const toggleMostPlayed = useCallback(
    () => onSelectSort(sort === 'most_played' ? 'newest' : 'most_played'),
    [onSelectSort, sort],
  );

  const durationActions = useMemo<ActionSheetItem[]>(
    () =>
      DURATION_BUCKETS.map((bucket) => ({
        id: bucket,
        label: t(DURATION_LABEL_KEYS[bucket]),
        selected: bucket === durationBucket,
        onPress: () => {
          setDurationSheetVisible(false);
          onSelectDuration?.(bucket);
        },
      })),
    [durationBucket, onSelectDuration, t],
  );

  const sortActions = useMemo<ActionSheetItem[]>(() => {
    const items: ActionSheetItem[] = LIBRARY_SORT_OPTIONS.filter((option) => option.available).map((option) => ({
      id: option.id,
      label: option.id === sort ? `${t(SORT_LABEL_KEYS[option.id])} ✓` : t(SORT_LABEL_KEYS[option.id]),
      selected: option.id === sort,
      onPress: () => onSelectSort(option.id),
    }));
    items.push({
      id: 'view-mode',
      label: viewMode === 'grid' ? t('playerDesign.viewList') : t('playerDesign.viewGrid'),
      onPress: () => {
        onCloseSort();
        onToggleViewMode();
      },
    });
    if (controlsDirty) {
      items.push({
        id: 'reset',
        label: t('library.resetControls'),
        destructive: true,
        onPress: () => {
          onCloseSort();
          onReset();
          setSearchOpen(false);
        },
      });
    }
    return items;
  }, [controlsDirty, onCloseSort, onReset, onSelectSort, onToggleViewMode, sort, t, viewMode]);

  const qualityActions = useMemo<ActionSheetItem[]>(
    () => [
      {
        id: 'all-qualities',
        label: quality == null ? `${t('playerDesign.allQualities')} ✓` : t('playerDesign.allQualities'),
        selected: quality == null,
        onPress: () => onSelectQuality(null),
      },
      ...qualities.map((value) => ({
        id: value,
        label: value === quality ? `${value} ✓` : value,
        selected: value === quality,
        onPress: () => onSelectQuality(value),
      })),
    ],
    [onSelectQuality, qualities, quality, t],
  );

  return (
    <View testID={testID} style={{ gap: 10 }}>
      <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center' }}>
        <DsChipRow style={{ flex: 1, marginEnd: 0 }} testID={`${testID}-kinds`}>
          <DsChip
            label={t('playerDesign.kindVideos')}
            selected={kind === 'video'}
            onPress={() => onSelectKind('video')}
            testID={`${testID}-kind-video`}
          />
          <DsChip
            label={t('playerDesign.kindAudio')}
            selected={kind === 'audio'}
            onPress={() => onSelectKind('audio')}
            testID={`${testID}-kind-audio`}
          />
          <DsChip label={t('playerDesign.kindPlaylists')} onPress={onOpenPlaylists} testID={`${testID}-kind-playlists`} />
          <DsChip label={t('playerDesign.kindNetwork')} onPress={onOpenNetwork} testID={`${testID}-kind-network`} />
        </DsChipRow>
        <DsIconButton
          variant="plain"
          icon="search"
          accessibilityLabel={searchVisible ? t('playerDesign.hideSearch') : t('playerDesign.showSearch')}
          accessibilityHint={t('library.searchFilterHint')}
          onPress={toggleSearch}
          testID={`${testID}-search-toggle`}
        />
      </View>

      <DsChipRow testID={`${testID}-chips`}>
        {FILTER_CHIPS.map((chip) => (
          <DsChip
            key={chip.id}
            label={t(chip.label)}
            selected={filter === chip.id}
            onPress={() => pickFilter(chip.id)}
            testID={`${testID}-chip-${chip.id}`}
          />
        ))}
        <DsChip
          label={t('playerDesign.chipMostPlayed')}
          selected={sort === 'most_played'}
          onPress={toggleMostPlayed}
          testID={`${testID}-chip-most-played`}
        />
        {MORE_FILTER_CHIPS.map((chip) => (
          <DsChip
            key={chip.id}
            label={t(chip.label)}
            selected={filter === chip.id}
            onPress={() => pickFilter(chip.id)}
            testID={`${testID}-chip-${chip.id}`}
          />
        ))}
        {qualities.length > 0 ? (
          <DsChip
            label={quality ?? t('library.qualityTitle')}
            selected={Boolean(quality)}
            onPress={onOpenQuality}
            testID={`${testID}-quality-chip`}
          />
        ) : null}
        {onSelectDuration ? (
          <DsChip
            label={t(DURATION_LABEL_KEYS[durationBucket] ?? 'libraryStats.durationAny')}
            selected={durationBucket !== 'any'}
            onPress={() => setDurationSheetVisible(true)}
            testID={`${testID}-duration-chip`}
          />
        ) : null}
        <PlayerTagFilterChip testID={testID} />
        <DsChip
          label={sort === 'newest' || sort === 'most_played' ? t('playerDesign.chipSort') : t(SORT_LABEL_KEYS[sort])}
          selected={sort !== 'newest' && sort !== 'most_played'}
          onPress={onOpenSort}
          accessibilityLabel={t('playerDesign.sortA11y')}
          testID={`${testID}-sort-button`}
        />
      </DsChipRow>

      {searchVisible ? (
        <DsSearchField
          value={searchDraft}
          onChangeText={onChangeSearch}
          returnKeyType="search"
          autoFocus={!searchDraft}
          placeholder={t('library.searchPlaceholder')}
          accessibilityLabel={t('library.searchA11y')}
          accessibilityHint={t('library.searchFilterHint')}
          actions={[{ icon: 'x', accessibilityLabel: t('playerDesign.hideSearch'), onPress: toggleSearch }]}
          testID={`${testID}-search`}
        />
      ) : null}

      <ActionSheetModal
        visible={sortSheetVisible}
        onClose={onCloseSort}
        title={t('library.sortTitle')}
        subtitle={t('library.sortSubtitle')}
        actions={sortActions}
        testID={`${testID}-sort-sheet`}
      />
      <ActionSheetModal
        visible={qualitySheetVisible}
        onClose={onCloseQuality}
        title={t('library.qualityTitle')}
        subtitle={t('library.qualitySubtitle')}
        actions={qualityActions}
        testID={`${testID}-quality-sheet`}
      />
      <ActionSheetModal
        visible={durationSheetVisible}
        onClose={() => setDurationSheetVisible(false)}
        title={t('libraryStats.durationTitle')}
        subtitle={t('libraryStats.durationSubtitle')}
        actions={durationActions}
        testID={`${testID}-duration-sheet`}
      />
    </View>
  );
});
