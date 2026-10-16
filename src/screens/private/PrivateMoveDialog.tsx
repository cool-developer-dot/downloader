import { memo } from 'react';

import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { useTranslation } from '@/localization';

import type { PrivateMoveController } from './usePrivateMove';

export type PrivateMoveDialogProps = {
  controller: PrivateMoveController;
  testID?: string;
};

/** The dialogs of "Move to Private": set up App Lock first, the confirm, then the move's progress. */
export const PrivateMoveDialog = memo(function PrivateMoveDialog({
  controller,
  testID = 'private-move-dialog',
}: PrivateMoveDialogProps) {
  const { t } = useTranslation();
  const { dialog, confirm, cancel, setUpAppLock } = controller;

  if (dialog.kind === 'needs-app-lock') {
    return (
      <ConfirmModal
        visible
        variant="warning"
        title={t('privateVault.needsAppLockTitle')}
        message={t('privateVault.needsAppLockMessage')}
        confirmLabel={t('privateVault.setUpAppLock')}
        cancelLabel={t('privateVault.notNow')}
        onConfirm={setUpAppLock}
        onCancel={cancel}
        testID={`${testID}-app-lock`}
      />
    );
  }

  if (dialog.kind === 'confirm' || dialog.kind === 'moving') {
    const moving = dialog.kind === 'moving';
    const message = moving
      ? dialog.percent
        ? t('privateVault.moving', { percent: dialog.percent })
        : t('privateVault.movingPlain')
      : [
          t('privateVault.moveMessage', { title: dialog.title, size: dialog.spaceLabel ?? '' }),
          dialog.inGallery ? t('privateVault.moveGalleryNote') : null,
        ]
          .filter(Boolean)
          .join('\n\n');
    return (
      <ConfirmModal
        visible
        variant="warning"
        title={t('privateVault.moveTitle')}
        message={message}
        confirmLabel={t('privateVault.moveConfirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          void confirm();
        }}
        onCancel={cancel}
        loading={moving}
        testID={`${testID}-confirm`}
      />
    );
  }

  return null;
});
