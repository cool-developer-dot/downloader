import { memo, useMemo, useState } from 'react';
import { ScrollView } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { IconButton } from '@/components/buttons/IconButton';
import { Chip } from '@/components/common/Chip';
import { SearchField } from '@/components/inputs/SearchField';
import type { LibraryFilter, LibrarySort, LibraryViewMode } from '@/library';
import { DURATION_BUCKETS, type DurationBucket } from '@/library/duration-buckets';
import { useTranslation, type TranslationKey } from '@/localization';
import { PlayerTagFilterChip } from '@/screens/downloads/components/OrganizeFilterChips';

import {
  LIBRARY_FILTER_OPTIONS,
  LIBRARY_SORT_OPTIONS,
} from '../constants/library.constants';

const FILTER_LABEL_KEYS: Record<LibraryFilter, TranslationKey> = {
  all: 'library.filterAll',
  favorites: 'library.filterFavorites',
  recently_downloaded: 'library.filterRecentlyDownloaded',
  recently_watched: 'library.filterRecentlyWatched',
  folder: 'library.filterFolder',
  quality: 'library.qualityTitle',
};

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
import { useLibraryTokens } from '../theme/library-tokens';

export type LibraryHeaderControlsProps = {
  searchDraft: string;
  filter: LibraryFilter;
  sort: LibrarySort;
  viewMode: LibraryViewMode;
  quality: string | null;
  qualities: string[];
  controlsDirty: boolean;
  filterSheetVisible: boolean;
  sortSheetVisible: boolean;
  qualitySheetVisible: boolean;
  onChangeSearch: (value: string) => void;
  onOpenFilter: () => void;
  onCloseFilter: () => void;
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
  /** P9 #628: the filter sheet's "Include / exclude folders" row, and how many folders are hidden. */
  onOpenFolderVisibility?: () => void;
  hiddenFolderCount?: number;
};

export const LibraryHeaderControls = memo(function LibraryHeaderControls({
  searchDraft,
  filter,
  sort,
  viewMode,
  quality,
  qualities,
  controlsDirty,
  filterSheetVisible,
  sortSheetVisible,
  qualitySheetVisible,
  onChangeSearch,
  onOpenFilter,
  onCloseFilter,
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
  onOpenFolderVisibility,
  hiddenFolderCount = 0,
}: LibraryHeaderControlsProps) {
  const libraryTokens = useLibraryTokens();
  const { t } = useTranslation();
  const filterLabel = t(FILTER_LABEL_KEYS[filter] ?? 'library.filterAll');
  const sortLabel = t(SORT_LABEL_KEYS[sort] ?? 'library.sortNewest');
  // P9 #711: the length sheet belongs to its chip.
  const [durationSheetVisible, setDurationSheetVisible] = useState(false);
  const durationLabel = t(DURATION_LABEL_KEYS[durationBucket] ?? 'libraryStats.durationAny');

  const filterActions = useMemo<ActionSheetItem[]>(
    () => [
      ...LIBRARY_FILTER_OPTIONS.filter((option) => option.available).map((option) => ({
        id: option.id,
        label: option.id === filter ? `${t(FILTER_LABEL_KEYS[option.id])} ✓` : t(FILTER_LABEL_KEYS[option.id]),
        icon:
          option.id === 'all'
            ? 'format-list-bulleted'
            : option.id === 'favorites'
              ? 'heart-outline'
              : option.id === 'recently_downloaded'
                ? 'clock-outline'
                : 'filter-outline',
        onPress: () => onSelectFilter(option.id),
      })),
      // P9 #628: last, as on screen 18.
      ...(onOpenFolderVisibility
        ? [
            {
              id: 'p9-folder-visibility',
              label:
                hiddenFolderCount > 0
                  ? t('libraryStats.foldersHiddenCount', { count: hiddenFolderCount })
                  : t('libraryStats.foldersTitle'),
              icon: 'folder-eye-outline',
              onPress: onOpenFolderVisibility,
            },
          ]
        : []),
    ],
    [filter, hiddenFolderCount, onOpenFolderVisibility, onSelectFilter, t],
  );

  const durationActions = useMemo<ActionSheetItem[]>(
    () =>
      DURATION_BUCKETS.map((bucket) => ({
        id: bucket,
        label: t(DURATION_LABEL_KEYS[bucket]),
        selected: bucket === durationBucket,
        icon: 'timer-outline',
        onPress: () => onSelectDuration?.(bucket),
      })),
    [durationBucket, onSelectDuration, t],
  );

  const sortActions = useMemo<ActionSheetItem[]>(
    () =>
      LIBRARY_SORT_OPTIONS.filter((option) => option.available).map((option) => ({
        id: option.id,
        label: option.id === sort ? `${t(SORT_LABEL_KEYS[option.id])} ✓` : t(SORT_LABEL_KEYS[option.id]),
        icon:
          option.id === 'newest' || option.id === 'oldest'
            ? 'sort-calendar-descending'
            : option.id === 'name_asc' || option.id === 'name_desc'
              ? 'sort-alphabetical-ascending'
              : 'sort-numeric-descending',
        onPress: () => onSelectSort(option.id),
      })),
    [onSelectSort, sort, t],
  );

  const qualityActions = useMemo<ActionSheetItem[]>(
    () => [
      {
        id: 'all-qualities',
        label: quality == null ? 'All qualities ✓' : 'All qualities',
        icon: 'format-list-bulleted',
        onPress: () => onSelectQuality(null),
      },
      ...qualities.map((value) => ({
        id: value,
        label: value === quality ? `${value} ✓` : value,
        icon: 'high-definition' as const,
        onPress: () => onSelectQuality(value),
      })),
    ],
    [onSelectQuality, qualities, quality],
  );

  return (
    <Box testID={testID} gap={libraryTokens.spacing.controlsGap}>
      <Box px={libraryTokens.spacing.screenX}>
        <SearchField
          value={searchDraft}
          onChangeText={onChangeSearch}
          placeholder={t('library.searchPlaceholder')}
          accessibilityLabel={t('library.searchA11y')}
          accessibilityHint={t('library.searchFilterHint')}
          testID={`${testID}-search`}
        />
      </Box>

      <Box
        row
        px={libraryTokens.spacing.screenX}
        style={{ alignItems: 'center', gap: 8 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, alignItems: 'center', paddingRight: 8 }}
          style={{ flex: 1 }}>
          <Chip
            label={filterLabel}
            selected={filter !== 'all'}
            icon="filter-variant"
            onPress={onOpenFilter}
            testID={`${testID}-filter-chip`}
          />
          {qualities.length > 0 ? (
            <Chip
              label={quality ?? t('library.qualityTitle')}
              selected={Boolean(quality)}
              icon="high-definition"
              onPress={onOpenQuality}
              testID={`${testID}-quality-chip`}
            />
          ) : null}
          <Chip
            label={sortLabel}
            selected={sort !== 'newest'}
            icon="sort"
            onPress={onOpenSort}
            testID={`${testID}-sort-chip`}
          />
          {onSelectDuration ? (
            <Chip
              label={durationLabel}
              selected={durationBucket !== 'any'}
              icon="timer-outline"
              onPress={() => setDurationSheetVisible(true)}
              testID={`${testID}-duration-chip`}
            />
          ) : null}
          <PlayerTagFilterChip testID={testID} />
        </ScrollView>

        <IconButton
          icon={viewMode === 'grid' ? 'view-list-outline' : 'view-grid-outline'}
          accessibilityLabel={
            viewMode === 'grid' ? t('library.viewList') : t('library.viewGrid')
          }
          onPress={onToggleViewMode}
          variant="ghost"
          size="small"
          testID={`${testID}-view-mode`}
        />

        {controlsDirty ? (
          <IconButton
            icon="filter-remove-outline"
            accessibilityLabel={t('library.resetControls')}
            accessibilityHint={t('library.resetFiltersHint')}
            onPress={onReset}
            variant="ghost"
            size="small"
            testID={`${testID}-reset`}
          />
        ) : null}
      </Box>

      {filter !== 'all' || sort !== 'newest' || quality || durationBucket !== 'any' ? (
        <Box px={libraryTokens.spacing.screenX}>
          <Text variant="caption" color="textSecondary">
            {[
              filter !== 'all' ? `Filter: ${filterLabel}` : null,
              quality ? `Quality: ${quality}` : null,
              durationBucket !== 'any' ? t('libraryStats.lengthCaption', { label: durationLabel }) : null,
              sort !== 'newest' ? `Sort: ${sortLabel}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </Box>
      ) : null}

      <ActionSheetModal
        visible={filterSheetVisible}
        onClose={onCloseFilter}
        title={t('library.filterTitle')}
        subtitle={t('library.filterSubtitle')}
        actions={filterActions}
        testID={`${testID}-filter-sheet`}
      />

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
    </Box>
  );
});
