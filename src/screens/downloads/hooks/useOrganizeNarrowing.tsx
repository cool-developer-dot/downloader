import { useMemo, type ReactElement } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import type { MediaLibraryItem } from '@/library/types';
import { hasTag, matchesSize } from '@/library/item-organize';
import { useItemTagsStore, useOrganizeFiltersStore } from '@/library/item-organize-store';
import { useTranslation } from '@/localization';
import { useDownloadsStore } from '@/store/downloads';

import type { DownloadListSection } from '../utils/download-format';

export type NarrowedDownloads = {
  orderedIds: string[];
  sections: DownloadListSection[];
  /** "Nothing matches" with a way out; null while no filter is chosen. */
  emptyNotice: ReactElement | null;
};

function clearFilters(): void {
  const filters = useOrganizeFiltersStore.getState();
  filters.setDownloadsSize('all');
  filters.setDownloadsTag(null);
}

/**
 * H12: the Downloads list narrowed by Size (#396) and Tag (#387). A download of unknown size only shows under "All";
 * nothing chosen returns the very same arrays (the list is exactly as before).
 */
export function useNarrowedDownloads(orderedIds: string[], sections: DownloadListSection[]): NarrowedDownloads {
  const size = useOrganizeFiltersStore((s) => s.downloadsSize);
  const tag = useOrganizeFiltersStore((s) => s.downloadsTag);
  const tagsById = useItemTagsStore((s) => s.tagsById);
  const { t } = useTranslation();

  return useMemo(() => {
    if (size === 'all' && tag === null) {
      return { orderedIds, sections, emptyNotice: null };
    }
    const state = useDownloadsStore.getState();
    const keep = (id: string) => {
      const item = state.engineRowsById[id] ?? state.itemsById[id];
      return Boolean(item) && matchesSize(item?.fileSize, size) && (tag === null || hasTag(tagsById[id], tag));
    };
    const emptyNotice = (
      <Box px={20} py={32} gap={12} center testID="downloads-organize-empty">
        <Text variant="body" color="textSecondary" align="center">
          {t('organize.noMatch')}
        </Text>
        <Button title={t('organize.clearFilters')} variant="outline" size="small" onPress={clearFilters} />
      </Box>
    );
    return {
      orderedIds: orderedIds.filter(keep),
      sections: sections.map((section) => ({ ...section, data: section.data.filter(keep) })).filter((section) => section.data.length > 0),
      emptyNotice,
    };
  }, [orderedIds, sections, size, t, tag, tagsById]);
}

/** H12: Player narrowed by Tag (#387); no tag chosen returns the same array. */
export function useTagFilteredItems(items: MediaLibraryItem[]): MediaLibraryItem[] {
  const tag = useOrganizeFiltersStore((s) => s.playerTag);
  const tagsById = useItemTagsStore((s) => s.tagsById);
  return useMemo(
    () => (tag === null ? items : items.filter((item) => hasTag(tagsById[item.id] ?? tagsById[item.downloadId], tag))),
    [items, tag, tagsById],
  );
}
