import { useCallback } from 'react';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { useTranslation } from '@/localization';
import { canMoveToPrivate } from '@/private-vault/move-to-private.runtime';
import { usePrivateMove } from '@/screens/private/usePrivateMove';

/**
 * Player tab long-press sheet: "Move to Private" (#459) for completed library items, before Delete. Builds without
 * the vault get no action, and the sheet is exactly as before.
 */
export function usePrivateMoveSheet() {
  const { t } = useTranslation();
  const privateMove = usePrivateMove();
  const { request } = privateMove;
  const privateMoveActionsFor = useCallback(
    (id: string, close: () => void): ActionSheetItem[] =>
      canMoveToPrivate(id)
        ? [
            {
              id: 'move-to-private',
              label: t('privateVault.moveAction'),
              onPress: () => {
                close();
                void request(id);
              },
            },
          ]
        : [],
    [request, t],
  );
  return { privateMoveActionsFor, privateMove };
}
