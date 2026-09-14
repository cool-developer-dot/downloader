import { memo, useMemo } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Card } from '@/components/cards/Card';
import { useTranslation } from '@/localization';
import type { AppStorageBreakdown } from '@/storage-manager';
import { formatBytesLabel } from '@/storage-manager';

export type StorageBreakdownProps = {
  breakdown: AppStorageBreakdown;
  testID?: string;
};

export const StorageBreakdown = memo(function StorageBreakdown({
  breakdown,
  testID = 'storage-app-breakdown',
}: StorageBreakdownProps) {
  const { t } = useTranslation();

  const rows = useMemo(
    () => [
      { key: 'videos', label: t('storage.videos'), bytes: breakdown.videosBytes },
      { key: 'images', label: t('storage.images'), bytes: breakdown.imagesBytes },
      { key: 'cache', label: t('storage.cache'), bytes: breakdown.cacheBytes },
      { key: 'temp', label: t('storage.temp'), bytes: breakdown.tempBytes },
      { key: 'other', label: t('storage.other'), bytes: breakdown.otherBytes },
    ],
    [breakdown, t],
  );

  return (
    <Card elevation="sm" padding={12} testID={testID}>
      <Box gap={12}>
        <Box row rtlRow center style={{ justifyContent: 'space-between' }}>
          <Text variant="bodySmall" style={{ fontWeight: '600' }}>
            {t('storage.appUsage')}
          </Text>
          <Text variant="caption" color="primary">
            {formatBytesLabel(breakdown.totalBytes) ?? t('storage.unavailable')}
          </Text>
        </Box>

        {breakdown.estimated ? (
          <Text variant="caption" color="textSecondary">
            {t('storage.estimatedNote')}
          </Text>
        ) : null}

        {breakdown.scanError ? (
          <Text variant="caption" color="warning">
            {t('storage.partialScan')}
          </Text>
        ) : null}

        <Box gap={8}>
          {rows.map((row) => (
            <Box
              key={row.key}
              row
              rtlRow
              center
              style={{ justifyContent: 'space-between' }}>
              <Text variant="caption" color="textSecondary">
                {row.label}
              </Text>
              <Text variant="caption">
                {formatBytesLabel(row.bytes) ?? t('storage.zeroBytes')}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    </Card>
  );
});
