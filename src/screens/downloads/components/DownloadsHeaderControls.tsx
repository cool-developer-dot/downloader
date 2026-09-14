import { memo, useMemo } from 'react';
import { ScrollView } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { IconButton } from '@/components/buttons/IconButton';
import { Chip } from '@/components/common/Chip';
import { SearchField } from '@/components/inputs/SearchField';
import { useTranslation, type TranslationKey } from '@/localization';
import type { DownloadSortOption, DownloadUiFilter } from '@/store/downloads';

import {
  DOWNLOAD_FILTER_OPTIONS,
  DOWNLOAD_SORT_OPTIONS,
} from '../constants/downloads.constants';

const FILTER_LABEL_KEYS: Record<DownloadUiFilter, TranslationKey> = {
  all: 'downloads.filterAll',
  running: 'downloads.filterRunning',
  queued: 'downloads.filterQueued',
  paused: 'downloads.filterPaused',
  completed: 'downloads.filterCompleted',
  failed: 'downloads.filterFailed',
};

const SORT_LABEL_KEYS: Record<DownloadSortOption, TranslationKey> = {
  newest: 'downloads.sortNewest',
  oldest: 'downloads.sortOldest',
};
import { useDownloadsTokens } from '../theme/downloads-tokens';

export type DownloadsHeaderControlsProps = {
  searchDraft: string;
  statusFilter: DownloadUiFilter;
  sort: DownloadSortOption;
  controlsDirty: boolean;
  filterSheetVisible: boolean;
  sortSheetVisible: boolean;
  onChangeSearch: (value: string) => void;
  onSubmitSearch: (value: string) => void;
  onOpenFilter: () => void;
  onCloseFilter: () => void;
  onOpenSort: () => void;
  onCloseSort: () => void;
  onSelectFilter: (filter: DownloadUiFilter) => void;
  onSelectSort: (sort: DownloadSortOption) => void;
  onReset: () => void;
  testID?: string;
};

export const DownloadsHeaderControls = memo(function DownloadsHeaderControls({
  searchDraft,
  statusFilter,
  sort,
  controlsDirty,
  filterSheetVisible,
  sortSheetVisible,
  onChangeSearch,
  onSubmitSearch,
  onOpenFilter,
  onCloseFilter,
  onOpenSort,
  onCloseSort,
  onSelectFilter,
  onSelectSort,
  onReset,
  testID = 'downloads-controls',
}: DownloadsHeaderControlsProps) {
  const downloadsTokens = useDownloadsTokens();
  const { t } = useTranslation();
  const filterLabel = t(FILTER_LABEL_KEYS[statusFilter] ?? 'downloads.filterAll');
  const sortLabel = t(SORT_LABEL_KEYS[sort] ?? 'downloads.sortNewest');

  const filterActions = useMemo<ActionSheetItem[]>(
    () =>
      DOWNLOAD_FILTER_OPTIONS.map((option) => ({
        id: option.id,
        label:
          option.id === statusFilter
            ? `${t(FILTER_LABEL_KEYS[option.id])} ✓`
            : t(FILTER_LABEL_KEYS[option.id]),
        icon:
          option.id === 'all'
            ? 'format-list-bulleted'
            : option.id === 'running'
              ? 'progress-download'
              : option.id === 'queued'
                ? 'clock-outline'
                : option.id === 'paused'
                  ? 'pause-circle-outline'
                  : option.id === 'completed'
                    ? 'check-circle-outline'
                    : 'alert-circle-outline',
        onPress: () => onSelectFilter(option.id),
      })),
    [onSelectFilter, statusFilter, t],
  );

  const sortActions = useMemo<ActionSheetItem[]>(
    () =>
      DOWNLOAD_SORT_OPTIONS.map((option) => ({
        id: option.id,
        label: option.id === sort ? `${t(SORT_LABEL_KEYS[option.id])} ✓` : t(SORT_LABEL_KEYS[option.id]),
        icon: option.id === 'newest' ? 'sort-calendar-descending' : 'sort-calendar-ascending',
        onPress: () => onSelectSort(option.id),
      })),
    [onSelectSort, sort, t],
  );

  return (
    <Box testID={testID} gap={downloadsTokens.spacing.controlsGap}>
      <Box px={downloadsTokens.spacing.screenX}>
        <SearchField
          value={searchDraft}
          onChangeText={onChangeSearch}
          onSearch={onSubmitSearch}
          placeholder={t('downloads.searchPlaceholder')}
          accessibilityLabel={t('downloads.searchA11y')}
          accessibilityHint={t('downloads.searchFilterHint')}
          testID={`${testID}-search`}
        />
      </Box>

      <Box
        row
        px={downloadsTokens.spacing.screenX}
        style={{ alignItems: 'center', gap: 8 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, alignItems: 'center', paddingRight: 8 }}
          style={{ flex: 1 }}>
          <Chip
            label={filterLabel}
            selected={statusFilter !== 'all'}
            icon="filter-variant"
            onPress={onOpenFilter}
            testID={`${testID}-filter-chip`}
          />
          <Chip
            label={sortLabel}
            selected={sort !== 'newest'}
            icon="sort"
            onPress={onOpenSort}
            testID={`${testID}-sort-chip`}
          />
        </ScrollView>

        {controlsDirty ? (
          <IconButton
            icon="filter-remove-outline"
            accessibilityLabel={t('downloads.resetControls')}
            accessibilityHint={t('downloads.resetFiltersHint')}
            onPress={onReset}
            variant="ghost"
            size="small"
            testID={`${testID}-reset`}
          />
        ) : null}
      </Box>

      {statusFilter !== 'all' || sort !== 'newest' ? (
        <Box px={downloadsTokens.spacing.screenX}>
          <Text variant="caption" color="textSecondary">
            {[
              statusFilter !== 'all' ? `Filter: ${filterLabel}` : null,
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
        title={t('downloads.filterTitle')}
        subtitle={t('downloads.filterSubtitle')}
        actions={filterActions}
        testID={`${testID}-filter-sheet`}
      />

      <ActionSheetModal
        visible={sortSheetVisible}
        onClose={onCloseSort}
        title={t('downloads.sortTitle')}
        subtitle={t('downloads.sortSubtitle')}
        actions={sortActions}
        testID={`${testID}-sort-sheet`}
      />
    </Box>
  );
});
