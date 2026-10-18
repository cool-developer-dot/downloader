import { useMemo } from 'react';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { insertActionBefore } from '@/downloads/v2/thumbnail-save';
import { useTranslation } from '@/localization';
import { useCanSaveThumbnail, useSaveThumbnail } from '@/screens/downloads/hooks/useSaveThumbnail';

/**
 * Player tab long-press sheet: the existing actions, plus "Save thumbnail" before Delete when it applies. When it
 * does not, the very same array comes back, so the sheet is unchanged.
 */
export function useWithSaveThumbnailAction(
  actions: ActionSheetItem[],
  itemId: string | null,
  close: () => void,
): ActionSheetItem[] {
  const { t } = useTranslation();
  const visible = useCanSaveThumbnail(itemId);
  const save = useSaveThumbnail();
  return useMemo(() => {
    if (!visible || !itemId) {
      return actions;
    }
    return insertActionBefore(
      actions,
      {
        id: 'save-thumbnail',
        label: t('thumbnailSave.action'),
        onPress: () => {
          close();
          void save(itemId);
        },
      },
      'delete',
    );
  }, [actions, close, itemId, save, t, visible]);
}
