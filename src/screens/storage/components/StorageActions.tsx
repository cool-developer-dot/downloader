import { memo, useCallback } from 'react';
import { Alert } from 'react-native';

import { Box } from '@/components/base/Box';
import { Button } from '@/components/buttons/Button';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';

export type StorageActionsProps = {
  onRefresh: () => void;
  onClearCache: () => void;
  refreshing: boolean;
  clearingCache: boolean;
  testID?: string;
};

export const StorageActions = memo(function StorageActions({
  onRefresh,
  onClearCache,
  refreshing,
  clearingCache,
  testID = 'storage-actions',
}: StorageActionsProps) {
  const { t } = useTranslation();

  const openDownloads = useCallback(() => {
    navigation.navigate(routePaths.downloads);
  }, []);

  const openLibrary = useCallback(() => {
    navigation.navigate(routePaths.library);
  }, []);

  const confirmClearCache = useCallback(() => {
    Alert.alert(
      t('storage.clearCacheTitle'),
      t('storage.clearCacheMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('storage.clearCacheConfirm'),
          style: 'destructive',
          onPress: onClearCache,
        },
      ],
    );
  }, [onClearCache, t]);

  return (
    <Box testID={testID} gap={8}>
      <Box row gap={8}>
        <Box flex={1}>
          <Button
            title={t('storage.openDownloads')}
            leftIcon="download-outline"
            variant="outline"
            size="small"
            onPress={openDownloads}
            fullWidth
            testID={`${testID}-downloads`}
          />
        </Box>
        <Box flex={1}>
          <Button
            title={t('storage.openLibrary')}
            leftIcon="folder-outline"
            variant="outline"
            size="small"
            onPress={openLibrary}
            fullWidth
            testID={`${testID}-library`}
          />
        </Box>
      </Box>
      <Box row gap={8}>
        <Box flex={1}>
          <Button
            title={t('storage.refresh')}
            leftIcon="refresh"
            variant="ghost"
            size="small"
            loading={refreshing}
            onPress={onRefresh}
            fullWidth
            testID={`${testID}-refresh`}
          />
        </Box>
        <Box flex={1}>
          <Button
            title={t('storage.clearCache')}
            leftIcon="delete-sweep-outline"
            variant="ghost"
            size="small"
            loading={clearingCache}
            onPress={confirmClearCache}
            fullWidth
            testID={`${testID}-clear-cache`}
          />
        </Box>
      </Box>
    </Box>
  );
});
