import { memo, useMemo } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Card } from '@/components/cards/Card';
import { ProgressBar } from '@/components/common/ProgressBar';
import { useTranslation } from '@/localization';
import type { DeviceStorageSnapshot } from '@/storage-manager';
import { formatBytesLabel, formatUsagePercent } from '@/storage-manager';

export type StorageOverviewCardProps = {
  device: DeviceStorageSnapshot;
  testID?: string;
};

export const StorageOverviewCard = memo(function StorageOverviewCard({
  device,
  testID = 'storage-device-overview',
}: StorageOverviewCardProps) {
  const { t } = useTranslation();

  const rows = useMemo(
    () => [
      {
        label: t('storage.total'),
        value: formatBytesLabel(device.totalBytes),
      },
      {
        label: t('storage.used'),
        value: formatBytesLabel(device.usedBytes),
      },
      {
        label: t('storage.free'),
        value: formatBytesLabel(device.freeBytes),
      },
    ],
    [device.freeBytes, device.totalBytes, device.usedBytes, t],
  );

  const percentLabel = formatUsagePercent(device.usageRatio);

  return (
    <Card elevation="sm" padding={12} testID={testID}>
      <Box gap={12}>
        <Text variant="bodySmall" style={{ fontWeight: '600' }}>
          {t('storage.deviceOverview')}
        </Text>

        {device.available ? (
          <>
            {device.usageRatio != null ? (
              <Box gap={8}>
                <Box row rtlRow center style={{ justifyContent: 'space-between' }}>
                  <Text variant="caption" color="textSecondary">
                    {t('storage.storageUsed')}
                  </Text>
                  {percentLabel ? (
                    <Text variant="caption" color="primary">
                      {percentLabel}
                    </Text>
                  ) : null}
                </Box>
                <ProgressBar
                  progress={device.usageRatio}
                  style={{ height: 6 }}
                  accessibilityLabel={t('storage.deviceUsageA11y', {
                    percent: Math.round(device.usageRatio * 100),
                  })}
                />
              </Box>
            ) : null}

            <Box gap={8}>
              {rows.map((row) => (
                <Box
                  key={row.label}
                  row
                  rtlRow
                  center
                  style={{ justifyContent: 'space-between' }}>
                  <Text variant="caption" color="textSecondary">
                    {row.label}
                  </Text>
                  <Text variant="caption">{row.value ?? t('storage.unavailable')}</Text>
                </Box>
              ))}
            </Box>
          </>
        ) : (
          <Text variant="caption" color="textSecondary">
            {t('storage.deviceUnavailable')}
          </Text>
        )}
      </Box>
    </Card>
  );
});
