import { memo, useMemo } from 'react';

import { Box } from '@/components/base/Box';
import { Icon, type IconName } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';

import { AppModal } from './AppModal';

export type ConfirmModalVariant = 'success' | 'warning' | 'error' | 'delete';

export type ConfirmModalProps = {
  visible: boolean;
  variant?: ConfirmModalVariant;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  loading?: boolean;
  testID?: string;
};

const variantConfig: Record<
  ConfirmModalVariant,
  { icon: IconName; iconColor: 'success' | 'warning' | 'error'; confirmVariant: 'primary' | 'destructive' }
> = {
  success: { icon: 'check-circle', iconColor: 'success', confirmVariant: 'primary' },
  warning: { icon: 'alert-circle', iconColor: 'warning', confirmVariant: 'primary' },
  error: { icon: 'alert-circle', iconColor: 'error', confirmVariant: 'destructive' },
  delete: { icon: 'trash-can-outline', iconColor: 'error', confirmVariant: 'destructive' },
};

export const ConfirmModal = memo(function ConfirmModal({
  visible,
  variant = 'warning',
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  loading = false,
  testID,
}: ConfirmModalProps) {
  const config = useMemo(() => variantConfig[variant], [variant]);

  return (
    <AppModal visible={visible} onClose={onCancel} showCloseButton={false} testID={testID}>
      <Box center gap={16}>
        <Icon name={config.icon} size="xl" color={config.iconColor} />
        <Box center gap={8}>
          <Text variant="title" align="center">
            {title}
          </Text>
          {message ? (
            <Text variant="bodySmall" color="textSecondary" align="center">
              {message}
            </Text>
          ) : null}
        </Box>
        <Box row gap={12} style={{ alignSelf: 'stretch' }}>
          <Box flex={1}>
            <Button title={cancelLabel} variant="outline" onPress={onCancel} fullWidth />
          </Box>
          <Box flex={1}>
            <Button
              title={confirmLabel}
              variant={config.confirmVariant}
              onPress={onConfirm}
              loading={loading}
              fullWidth
            />
          </Box>
        </Box>
      </Box>
    </AppModal>
  );
});
