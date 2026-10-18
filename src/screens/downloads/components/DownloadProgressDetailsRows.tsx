import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { useDownloadProgressDetails } from '../hooks/useDownloadProgressDetails';
import { DownloadSpeedGraph } from './DownloadSpeedGraph';

function DetailsRow({ label, value, testID }: { label: string; value: string; testID: string }) {
  const theme = useTheme();
  return (
    <Box
      row
      py={10}
      testID={testID}
      style={{
        justifyContent: 'space-between',
        gap: 16,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
      }}
      accessibilityLabel={`${label}: ${value}`}>
      <Text variant="bodySmall" color="textSecondary">
        {label}
      </Text>
      <Box flex={1} style={{ minWidth: 0 }}>
        <Text variant="bodySmall" color="textPrimary" numberOfLines={1} style={{ textAlign: 'right' }}>
          {value}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Download Details: Remaining Size (#308), Average Speed (#312), Elapsed Time (#314), Segment Progress (#315) and
 * Speed Graph (#316) of a queued, running or paused v2 download. Each row is left out while its value is unknown.
 */
export const DownloadProgressDetailsRows = memo(function DownloadProgressDetailsRows({ id }: { id: string }) {
  const { t } = useTranslation();
  const details = useDownloadProgressDetails(id);

  return (
    <>
      {details.remaining ? (
        <DetailsRow
          label={t('downloadProgress.remaining')}
          value={details.remaining}
          testID="download-details-remaining"
        />
      ) : null}
      {details.averageSpeed ? (
        <DetailsRow
          label={t('downloadProgress.averageSpeed')}
          value={details.averageSpeed}
          testID="download-details-average-speed"
        />
      ) : null}
      {details.elapsed ? (
        <DetailsRow
          label={t('downloadProgress.elapsed')}
          value={details.elapsed}
          testID="download-details-elapsed"
        />
      ) : null}
      {details.segments ? (
        <DetailsRow
          label={t('downloadProgress.segments')}
          value={t('downloadProgress.segmentsValue', {
            done: details.segments.done,
            total: details.segments.total,
          })}
          testID="download-details-segments"
        />
      ) : null}
      {details.graph ? (
        <Box py={10} gap={6}>
          <Text variant="bodySmall" color="textSecondary">
            {t('downloadProgress.speedGraph')}
          </Text>
          <DownloadSpeedGraph
            points={details.graph.points}
            maxBps={details.graph.maxBps}
            accessibilityLabel={t('downloadProgress.speedGraphA11y')}
            testID="download-details-speed-graph"
          />
        </Box>
      ) : null}
    </>
  );
});
