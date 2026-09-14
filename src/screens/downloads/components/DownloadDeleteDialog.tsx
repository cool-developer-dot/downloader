import { memo } from 'react';

import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { useTranslation } from '@/localization';

export type DownloadDeleteDialogProps = {
  visible: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
};

export const DownloadDeleteDialog = memo(function DownloadDeleteDialog({
  visible,
  loading = false,
  onConfirm,
  onCancel,
  testID = 'downloads-delete-dialog',
}: DownloadDeleteDialogProps) {
  const { t } = useTranslation();
  return (
    <ConfirmModal
      visible={visible}
      variant="delete"
      title={t('downloads.deleteTitle')}
      message={t('downloads.deleteMessage')}
      confirmLabel={t('downloads.deleteConfirm')}
      cancelLabel={t('downloads.deleteCancel')}
      onConfirm={onConfirm}
      onCancel={onCancel}
      loading={loading}
      testID={testID}
    />
  );
});
