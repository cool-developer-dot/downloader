import { useMemo } from 'react';

import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';

import type { MoreAction } from '../components/SelectionBar';

/**
 * Files F4: what the selection bar's More ⋮ holds, one block per package — F5 Rename (the batch rename page for the
 * selected files). F7 adds Tag, Color and Hide here.
 */
export function useSelectionMoreActions(): MoreAction[] {
  const { t } = useTranslation();
  return useMemo<MoreAction[]>(
    () => [
      // F5 #793: rename the selected files at once.
      {
        id: 'rename',
        label: t('common.rename'),
        onPress: (entries) => {
          const ids = entries.flatMap((entry) => (entry.kind === 'file' ? [entry.file.id] : []));
          if (ids.length > 0) {
            navigation.push(`${routePaths.filesBatchRename}?ids=${encodeURIComponent(ids.join(','))}`);
          }
        },
      },
    ],
    [t],
  );
}
