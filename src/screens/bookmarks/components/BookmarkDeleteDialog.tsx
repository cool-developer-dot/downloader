import { memo } from 'react';

import { ConfirmModal } from '@/components/modals/ConfirmModal';

import { useTranslation } from '@/localization';

export type BookmarkDeleteDialogProps = {
  mode: 'delete' | 'clear';
  visible: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
};

export const BookmarkDeleteDialog = memo(function BookmarkDeleteDialog({
  mode,
  visible,
  loading = false,
  onConfirm,
  onCancel,
  testID,
}: BookmarkDeleteDialogProps) {
  const isClear = mode === 'clear';
  const { t } = useTranslation();

  return (
    <ConfirmModal
      visible={visible}
      variant="delete"
      title={isClear ? t('bookmarks.clearTitle') : t('bookmarks.deleteTitle')}
      message={isClear ? t('bookmarks.clearMessage') : t('bookmarks.deleteMessage')}
      confirmLabel={isClear ? t('bookmarks.clearConfirm') : t('bookmarks.deleteConfirm')}
      cancelLabel={isClear ? t('bookmarks.clearCancel') : t('bookmarks.deleteCancel')}
      onConfirm={onConfirm}
      onCancel={onCancel}
      loading={loading}
      testID={testID ?? (isClear ? 'bookmarks-clear-dialog' : 'bookmarks-delete-dialog')}
    />
  );
});
