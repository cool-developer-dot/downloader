import { useCallback } from 'react';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { useTranslation } from '@/localization';
import { useDownloadsStore } from '@/store/downloads';

import { openTagEditor } from '../components/OrganizeHosts';

/** H12 (#387): the Player's long-press menu → "Tags…", which opens the tag editor for that video. */
export function useTagSheetActions(): (id: string, close: () => void) => ActionSheetItem[] {
  const { t } = useTranslation();
  return useCallback(
    (id: string, close: () => void) => [
      {
        id: 'tags',
        label: t('organize.tagsAction'),
        icon: 'tag-outline',
        onPress: () => {
          close();
          const state = useDownloadsStore.getState();
          openTagEditor(id, (state.engineRowsById[id] ?? state.itemsById[id])?.title ?? '');
        },
      },
    ],
    [t],
  );
}
