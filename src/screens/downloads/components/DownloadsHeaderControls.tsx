import { memo, useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { DsChip, DsChipRow, DsIconButton, DsSearchField } from '@/design';
import { useRtl, useTranslation, type TranslationKey } from '@/localization';
import type { DownloadSortOption, DownloadUiFilter } from '@/store/downloads';

import { DOWNLOAD_SORT_OPTIONS } from '../constants/downloads.constants';
import { DownloadsOrganizeFilterChips } from './OrganizeFilterChips';

/** The design's chips, in its order: All · Active · Queued · Completed · Paused · Failed ("Active" = running). */
const CHIPS: readonly { id: DownloadUiFilter; label: TranslationKey }[] = [
  { id: 'all', label: 'downloads.filterAll' },
  { id: 'running', label: 'lightDownloads.chipActive' },
  { id: 'queued', label: 'downloads.filterQueued' },
  { id: 'completed', label: 'downloads.filterCompleted' },
  { id: 'paused', label: 'downloads.filterPaused' },
  { id: 'failed', label: 'downloads.filterFailed' },
];

const SORT_LABEL_KEYS: Record<DownloadSortOption, TranslationKey> = {
  newest: 'downloads.sortNewest',
  oldest: 'downloads.sortOldest',
};

export type DownloadsHeaderControlsProps = {
  searchDraft: string;
  statusFilter: DownloadUiFilter;
  sort: DownloadSortOption;
  controlsDirty: boolean;
  sortSheetVisible: boolean;
  onChangeSearch: (value: string) => void;
  onSubmitSearch: (value: string) => void;
  onOpenSort: () => void;
  onCloseSort: () => void;
  onSelectFilter: (filter: DownloadUiFilter) => void;
  onSelectSort: (sort: DownloadSortOption) => void;
  onReset: () => void;
  testID?: string;
};

/**
 * The status chips of design 10 bound to the store's filter, with the Size / Tag chips after them. The search field
 * is hidden behind the plain search button at the end of the row (it stays open while a search is typed); the sort
 * button opens the existing sort sheet, which also carries the "Reset" of a changed search / filter / sort.
 */
export const DownloadsHeaderControls = memo(function DownloadsHeaderControls({
  searchDraft,
  statusFilter,
  sort,
  controlsDirty,
  sortSheetVisible,
  onChangeSearch,
  onSubmitSearch,
  onOpenSort,
  onCloseSort,
  onSelectFilter,
  onSelectSort,
  onReset,
  testID = 'downloads-controls',
}: DownloadsHeaderControlsProps) {
  const { t } = useTranslation();
  const rtl = useRtl();
  const [searchOpen, setSearchOpen] = useState(Boolean(searchDraft.trim()));
  const searchVisible = searchOpen || Boolean(searchDraft.trim());

  const toggleSearch = useCallback(() => {
    if (searchVisible) {
      if (searchDraft) {
        onSubmitSearch('');
      }
      setSearchOpen(false);
      return;
    }
    setSearchOpen(true);
  }, [onSubmitSearch, searchDraft, searchVisible]);

  const clearSearch = useCallback(() => {
    onSubmitSearch('');
    setSearchOpen(false);
  }, [onSubmitSearch]);

  const sortActions = useMemo<ActionSheetItem[]>(() => {
    const items: ActionSheetItem[] = DOWNLOAD_SORT_OPTIONS.map((option) => ({
      id: option.id,
      label: option.id === sort ? `${t(SORT_LABEL_KEYS[option.id])} ✓` : t(SORT_LABEL_KEYS[option.id]),
      selected: option.id === sort,
      onPress: () => onSelectSort(option.id),
    }));
    if (controlsDirty) {
      items.push({
        id: 'reset',
        label: t('lightDownloads.resetControls'),
        destructive: true,
        onPress: () => {
          onReset();
          setSearchOpen(false);
        },
      });
    }
    return items;
  }, [controlsDirty, onReset, onSelectSort, sort, t]);

  return (
    <View testID={testID} style={{ gap: 10 }}>
      <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center' }}>
        <DsChipRow style={{ flex: 1, marginEnd: 0 }} testID={`${testID}-chips`}>
          {CHIPS.map((chip) => (
            <DsChip
              key={chip.id}
              label={t(chip.label)}
              selected={statusFilter === chip.id}
              onPress={() => onSelectFilter(chip.id)}
              testID={`${testID}-chip-${chip.id}`}
            />
          ))}
          <DownloadsOrganizeFilterChips testID={testID} />
        </DsChipRow>
        <DsIconButton
          variant="plain"
          icon="search"
          accessibilityLabel={searchVisible ? t('lightDownloads.hideSearch') : t('lightDownloads.showSearch')}
          accessibilityHint={t('downloads.searchFilterHint')}
          onPress={toggleSearch}
          testID={`${testID}-search-toggle`}
        />
        <DsIconButton
          variant="plain"
          icon="arrow-up-down"
          accessibilityLabel={t('lightDownloads.sortA11y')}
          onPress={onOpenSort}
          testID={`${testID}-sort-button`}
        />
      </View>

      {searchVisible ? (
        <DsSearchField
          value={searchDraft}
          onChangeText={onChangeSearch}
          onSubmitEditing={(event) => onSubmitSearch(event.nativeEvent.text)}
          returnKeyType="search"
          autoFocus={!searchDraft}
          placeholder={t('downloads.searchPlaceholder')}
          accessibilityLabel={t('downloads.searchA11y')}
          accessibilityHint={t('downloads.searchFilterHint')}
          actions={[{ icon: 'x', accessibilityLabel: t('lightDownloads.clearSearch'), onPress: clearSearch }]}
          testID={`${testID}-search`}
        />
      ) : null}

      <ActionSheetModal
        visible={sortSheetVisible}
        onClose={onCloseSort}
        title={t('downloads.sortTitle')}
        subtitle={t('downloads.sortSubtitle')}
        actions={sortActions}
        testID={`${testID}-sort-sheet`}
      />
    </View>
  );
});
