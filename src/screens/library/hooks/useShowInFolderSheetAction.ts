import { useCallback } from 'react';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { showInFolderTarget } from '@/downloads/v2/save-location';
import { useExternalCopiesStore } from '@/downloads/v2/save-location-store';
import { showItemInFolder } from '@/downloads/v2/show-in-folder';
import { useTranslation } from '@/localization';

/**
 * Player tab long-press sheet: "Show in folder" (#398) for an item that has an external copy (#297), and nothing for
 * any other item — the sheet is then exactly as before.
 */
export function useShowInFolderSheetActions(): (id: string, close: () => void) => ActionSheetItem[] {
  const { t } = useTranslation();
  const records = useExternalCopiesStore((s) => s.records);
  return useCallback(
    (id: string, close: () => void) => {
      if (!showInFolderTarget(records[id])) {
        return [];
      }
      return [
        {
          id: 'show-in-folder',
          label: t('saveLocation.showInFolder'),
          onPress: () => {
            close();
            void showItemInFolder(id);
          },
        },
      ];
    },
    [records, t],
  );
}
