import { memo } from 'react';

import { ConfirmModal } from '@/components/modals/ConfirmModal';

import { useTranslation } from '@/localization';

export type HistoryDeleteDialogProps = {
  mode: 'delete' | 'clear' | 'clearSearches';
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
  const { t } = useTranslation();
  const copy = {
    delete: {
      title: t('history.deleteTitle'),
      message: t('history.deleteMessage'),
      confirm: t('history.deleteConfirm'),
      cancel: t('history.deleteCancel'),
      testID: 'history-delete-dialog',
    },
    clear: {
      title: t('history.clearTitle'),
      message: t('history.clearMessage'),
      confirm: t('history.clearConfirm'),
      cancel: t('history.clearCancel'),
      testID: 'history-clear-dialog',
    },
    clearSearches: {
      title: t('history.clearSearchesTitle'),
      message: t('history.clearSearchesMessage'),
      confirm: t('history.clearSearchesConfirm'),
      cancel: t('history.clearCancel'),
      testID: 'history-clear-searches-dialog',
    },
  }[mode];

  return (
    <ConfirmModal
      visible={visible}
      variant="delete"
      title={copy.title}
      message={copy.message}
      confirmLabel={copy.confirm}
      cancelLabel={copy.cancel}
      onConfirm={onConfirm}
      onCancel={onCancel}
      loading={loading}
      testID={testID ?? copy.testID}
    />
  );
});
