import { memo } from 'react';

import { ConfirmModal } from '@/components/modals/ConfirmModal';

import { useTranslation } from '@/localization';

export type HistoryDeleteDialogProps = {
  mode: 'delete' | 'clear';
  visible: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
};

export const HistoryDeleteDialog = memo(function HistoryDeleteDialog({
  mode,
  visible,
  loading = false,
  onConfirm,
  onCancel,
  testID,
}: HistoryDeleteDialogProps) {
  const isClear = mode === 'clear';
  const { t } = useTranslation();

  return (
    <ConfirmModal
      visible={visible}
      variant="delete"
      title={isClear ? t('history.clearTitle') : t('history.deleteTitle')}
      message={isClear ? t('history.clearMessage') : t('history.deleteMessage')}
      confirmLabel={isClear ? t('history.clearConfirm') : t('history.deleteConfirm')}
      cancelLabel={isClear ? t('history.clearCancel') : t('history.deleteCancel')}
      onConfirm={onConfirm}
      onCancel={onCancel}
      loading={loading}
      testID={testID ?? (isClear ? 'history-clear-dialog' : 'history-delete-dialog')}
    />
  );
});
