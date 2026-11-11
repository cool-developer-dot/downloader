import { memo, useMemo, useState } from 'react';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { Chip } from '@/components/common/Chip';
import { allTags, SIZE_BUCKETS, type SizeBucket } from '@/library/item-organize';
import { useItemTagsStore, useOrganizeFiltersStore } from '@/library/item-organize-store';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';

const SIZE_KEYS: Record<SizeBucket, TranslationKey> = {
  all: 'organize.sizeAll',
  under50: 'organize.sizeUnder50',
  '50to500': 'organize.size50to500',
  '500to2g': 'organize.size500to2g',
  over2g: 'organize.sizeOver2g',
};

type TagSheetProps = {
  visible: boolean;
  selected: string | null;
  onSelect: (tag: string | null) => void;
  onClose: () => void;
  testID: string;
};

/** Every tag in use, with how many saved videos have it, plus "All tags". */
const TagFilterSheet = memo(function TagFilterSheet({ visible, selected, onSelect, onClose, testID }: TagSheetProps) {
  const { t } = useTranslation();
  const tagsById = useItemTagsStore((s) => s.tagsById);
  const actions = useMemo<ActionSheetItem[]>(
    () => [
      {
        id: 'tag-all',
        label: selected === null ? `${t('organize.tagAll')} ✓` : t('organize.tagAll'),
        selected: selected === null,
        onPress: () => onSelect(null),
      },
      ...allTags(tagsById).map(({ tag, count }) => ({
        id: `tag-${tag}`,
        label: `${tag} · ${count}${selected?.toLocaleLowerCase() === tag.toLocaleLowerCase() ? ' ✓' : ''}`,
        selected: selected?.toLocaleLowerCase() === tag.toLocaleLowerCase(),
        icon: 'tag-outline',
        onPress: () => onSelect(tag),
      })),
    ],
    [onSelect, selected, t, tagsById],
  );
  return (
    <ActionSheetModal visible={visible} onClose={onClose} title={t('organize.tagFilterTitle')} actions={actions} testID={testID} />
  );
});

/** Shown only once some saved video has a tag, or while a tag is chosen. */
function useHasTags(selected: string | null): boolean {
  const any = useItemTagsStore((s) => Object.keys(s.tagsById).length > 0);
  return any || selected !== null;
}

/** Downloads → filters: Size (#396) and Tag (#387). Nothing chosen shows every download, as before. */
export const DownloadsOrganizeFilterChips = memo(function DownloadsOrganizeFilterChips({ testID }: { testID: string }) {
  const { t } = useTranslation();
  const size = useOrganizeFiltersStore((s) => s.downloadsSize);
  const tag = useOrganizeFiltersStore((s) => s.downloadsTag);
  const showTags = useHasTags(tag);
  const [sheet, setSheet] = useState<'size' | 'tag' | null>(null);

  const sizeActions = useMemo<ActionSheetItem[]>(
    () =>
      SIZE_BUCKETS.map((bucket) => ({
        id: `size-${bucket}`,
        label: bucket === size ? `${t(SIZE_KEYS[bucket])} ✓` : t(SIZE_KEYS[bucket]),
        selected: bucket === size,
        onPress: () => {
          setSheet(null);
          useOrganizeFiltersStore.getState().setDownloadsSize(bucket);
        },
      })),
    [size, t],
  );

  return (
    <>
      <Chip
        label={size === 'all' ? t('organize.size') : t(SIZE_KEYS[size])}
        selected={size !== 'all'}
        icon="harddisk"
        onPress={() => setSheet('size')}
        testID={`${testID}-size-chip`}
      />
      {showTags ? (
        <Chip
          label={tag ?? t('organize.tag')}
          selected={tag !== null}
          icon="tag-outline"
          onPress={() => setSheet('tag')}
          testID={`${testID}-tag-chip`}
        />
      ) : null}
      <ActionSheetModal
        visible={sheet === 'size'}
        onClose={() => setSheet(null)}
        title={t('organize.sizeFilterTitle')}
        subtitle={t('organize.sizeFilterHint')}
        actions={sizeActions}
        testID={`${testID}-size-sheet`}
      />
      <TagFilterSheet
        visible={sheet === 'tag'}
        selected={tag}
        onSelect={(next) => {
          setSheet(null);
          useOrganizeFiltersStore.getState().setDownloadsTag(next);
        }}
        onClose={() => setSheet(null)}
        testID={`${testID}-tag-sheet`}
      />
    </>
  );
});

/** Player → filters: Tag (#387). Nothing chosen shows every video, as before. */
export const PlayerTagFilterChip = memo(function PlayerTagFilterChip({ testID }: { testID: string }) {
  const { t } = useTranslation();
  const tag = useOrganizeFiltersStore((s) => s.playerTag);
  const showTags = useHasTags(tag);
  const [open, setOpen] = useState(false);

  if (!showTags) {
    return null;
  }
  return (
    <>
      <Chip
        label={tag ?? t('organize.tag')}
        selected={tag !== null}
        icon="tag-outline"
        onPress={() => setOpen(true)}
        testID={`${testID}-tag-chip`}
      />
      <TagFilterSheet
        visible={open}
        selected={tag}
        onSelect={(next) => {
          setOpen(false);
          useOrganizeFiltersStore.getState().setPlayerTag(next);
        }}
        onClose={() => setOpen(false)}
        testID={`${testID}-tag-sheet`}
      />
    </>
  );
});
