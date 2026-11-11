import { memo, useCallback } from 'react';

import { TextButton } from '@/components/buttons/TextButton';
import { isQueueOrderSupported, setReorderMode } from '@/downloads/v2/queue-order-store';
import { useTranslation } from '@/localization';
import { useDownloadsStore } from '@/store/downloads';

import type { DownloadListSection } from '../utils/download-format';

export type QueueReorderButtonProps = {
  sectionKey: DownloadListSection['key'];
};

/**
 * H4: "Reorder" in the Queued section's header (in the Paused one when nothing is queued). Shown only for downloads
 * of the native engine and on builds whose engine has queues.
 */
export const QueueReorderButton = memo(function QueueReorderButton({ sectionKey }: QueueReorderButtonProps) {
  const { t } = useTranslation();
  const visible = useDownloadsStore((s) => {
    if (sectionKey !== 'QUEUED' && sectionKey !== 'PAUSED') {
      return false;
    }
    const rows = Object.values(s.engineRowsById);
    const queued = rows.some((row) => row.status === 'QUEUED');
    return sectionKey === 'QUEUED' ? queued : !queued && rows.some((row) => row.status === 'PAUSED');
  });
  const open = useCallback(() => setReorderMode(true), []);

  if (!visible || !isQueueOrderSupported()) {
    return null;
  }
  return (
    <TextButton
      title={t('queueOrder.reorder')}
      size="small"
      leftIcon="swap-vertical"
      onPress={open}
      accessibilityLabel={t('queueOrder.reorderA11y')}
      testID="downloads-queue-reorder-button"
    />
  );
});
