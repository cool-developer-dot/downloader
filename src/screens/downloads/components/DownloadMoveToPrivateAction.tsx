import { memo, useCallback } from 'react';

import { Box } from '@/components/base/Box';
import { Button } from '@/components/buttons/Button';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import { canMoveToPrivate } from '@/private-vault/move-to-private.runtime';
import { PrivateMoveDialog } from '@/screens/private/PrivateMoveDialog';
import { usePrivateMove } from '@/screens/private/usePrivateMove';
import { useDownloadsStore } from '@/store/downloads';

export type DownloadMoveToPrivateActionProps = {
  id: string;
};

/**
 * Download details: "Move to Private" (#459) for a completed library item. Once the video is in the vault the
 * details have nothing left to show, so the screen goes back.
 */
export const DownloadMoveToPrivateAction = memo(function DownloadMoveToPrivateAction({
  id,
}: DownloadMoveToPrivateActionProps) {
  const { t } = useTranslation();
  // v2 rows live in engineRowsById (itemsById only holds what the Downloads list currently shows).
  const completed = useDownloadsStore((s) => (s.engineRowsById[id] ?? s.itemsById[id])?.status === 'COMPLETED');
  const onMoved = useCallback(() => {
    navigation.back();
  }, []);
  const privateMove = usePrivateMove(onMoved);

  if (!completed || !canMoveToPrivate(id)) {
    return null;
  }
  return (
    <Box mt={8}>
      <Button
        title={t('privateVault.moveAction')}
        variant="outline"
        leftIcon="lock-outline"
        onPress={() => {
          void privateMove.request(id);
        }}
        fullWidth
        accessibilityHint={t('privateVault.moveHint')}
        testID="download-details-move-to-private"
      />
      <PrivateMoveDialog controller={privateMove} testID="download-details-private-move" />
    </Box>
  );
});
