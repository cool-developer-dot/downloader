import { memo } from 'react';

import { ConfirmModal } from '@/components/modals/ConfirmModal';

import { useTranslation } from '@/localization';

export type FavoriteRemoveDialogProps = {
  visible: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
};

export const FavoriteRemoveDialog = memo(function FavoriteRemoveDialog({
  visible,
  loading = false,
  onConfirm,
  onCancel,
  testID = 'favorites-remove-dialog',
}: FavoriteRemoveDialogProps) {
  const { t } = useTranslation();
  return (
    <ConfirmModal
      visible={visible}
      variant="delete"
      title={t('favorites.removeTitle')}
      message={t('favorites.removeMessage')}
      confirmLabel={t('favorites.removeConfirm')}
      cancelLabel={t('favorites.removeCancel')}
      onConfirm={onConfirm}
      onCancel={onCancel}
      loading={loading}
      testID={testID}
    />
  );
});
