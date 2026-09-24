import { memo } from 'react';

import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { useTranslation } from '@/localization';

export type DownloadDeleteDialogProps = {
  visible: boolean;
  loading?: boolean;
  /**
   * `remove` is the finished-download case: the row leaves Downloads and the file stays in the Library, so the
   * dialog must not promise a deletion that does not happen.
   */
  mode?: 'delete' | 'remove';
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
};

export const DownloadDeleteDialog = memo(function DownloadDeleteDialog({
  visible,
  loading = false,
  mode = 'delete',
  onConfirm,
  onCancel,
  testID = 'downloads-delete-dialog',
}: DownloadDeleteDialogProps) {
  const { t } = useTranslation();
  const removing = mode === 'remove';
  return (
    <ConfirmModal
      visible={visible}
      variant="delete"
      title={removing ? t('downloads.removeTitle') : t('downloads.deleteTitle')}
      message={removing ? t('downloads.removeMessage') : t('downloads.deleteMessage')}
      confirmLabel={removing ? t('downloads.removeConfirm') : t('downloads.deleteConfirm')}
      cancelLabel={t('downloads.deleteCancel')}
      onConfirm={onConfirm}
      onCancel={onCancel}
      loading={loading}
      testID={testID}
    />
  );
});
