import { memo, useCallback } from 'react';
import { Alert, StyleSheet } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import type { LeftoverFilesState } from '@/downloads/v2/leftovers';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { formatBytesLabel } from '@/storage-manager/utils/format-bytes';

/**
 * Storage → "Leftover download files — X MB" with Clean up (F15). Hidden when there is nothing to clean; after a
 * clean-up it says what was freed.
 */
export const LeftoverFilesCard = memo(function LeftoverFilesCard({
  state,
  onCleaned,
}: {
  state: LeftoverFilesState;
  onCleaned?: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { available, leftovers, cleaning, freedBytes, failed, clean } = state;
  const bytes = leftovers?.bytes ?? 0;
  // Left-to-right marks keep "7.0 MB" in order inside Urdu sentences (no effect in English).
  const ltr = (text: string) => `\u200E${text}\u200E`;
  const size = ltr(formatBytesLabel(bytes) ?? '0 B');

  const confirm = useCallback(() => {
    Alert.alert(t('storage.leftoversConfirmTitle'), t('storage.leftoversConfirmMessage', { size }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('storage.leftoversClean'),
        style: 'destructive',
        onPress: () => {
          void clean().then(() => onCleaned?.());
        },
      },
    ]);
  }, [clean, onCleaned, size, t]);

  if (!available || (bytes <= 0 && freedBytes == null && !failed)) {
    return null;
  }

  return (
    <Box
      testID="storage-leftovers"
      gap={10}
      p={16}
      borderRadius="md"
      style={{
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
      }}>
      {bytes > 0 ? (
        <>
          <Box row rtlRow gap={12} style={{ alignItems: 'center' }}>
            <Icon name="broom" size={22} color="primary" />
            <Box flex={1} gap={4}>
              <Text variant="subtitle">{t('storage.leftoversTitle', { size })}</Text>
              <Text variant="caption" color="textSecondary">
                {t('storage.leftoversHint')}
              </Text>
            </Box>
          </Box>
          <Button
            title={t('storage.leftoversClean')}
            leftIcon="delete-sweep-outline"
            variant="outline"
            size="small"
            loading={cleaning}
            onPress={confirm}
            fullWidth
            testID="storage-leftovers-clean"
          />
        </>
      ) : null}
      {freedBytes != null ? (
        <Box row rtlRow gap={8} style={{ alignItems: 'center' }}>
          <Icon name="check-circle" size={18} color="success" />
          <Text variant="bodySmall" color="success" testID="storage-leftovers-freed">
            {t('storage.leftoversFreed', { size: ltr(formatBytesLabel(freedBytes) ?? '0 B') })}
          </Text>
        </Box>
      ) : null}
      {failed ? (
        <Text variant="caption" color="error">
          {t('storage.leftoversFailed')}
        </Text>
      ) : null}
    </Box>
  );
});
