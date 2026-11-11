import { memo } from 'react';

import { Text } from '@/components/base/Text';
import { useTranslation } from '@/localization';

import { useDownloadProgressDetails } from '../hooks/useDownloadProgressDetails';

/**
 * One line on a Downloads card: remaining size, average speed and elapsed active time of a queued, running or
 * paused v2 download. Renders nothing while all three are unknown.
 */
export const DownloadCardProgressStats = memo(function DownloadCardProgressStats({
  id,
  testID,
}: {
  id: string;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { remaining, averageSpeed, elapsed } = useDownloadProgressDetails(id);

  const parts = [
    remaining ? t('downloadProgress.remainingShort', { size: remaining }) : null,
    averageSpeed ? t('downloadProgress.averageShort', { speed: averageSpeed }) : null,
    elapsed ? t('downloadProgress.elapsedShort', { time: elapsed }) : null,
  ].filter((part): part is string => Boolean(part));

  if (parts.length === 0) {
    return null;
  }

  return (
    <Text variant="caption" color="textSecondary" numberOfLines={1} testID={testID}>
      {parts.join(' · ')}
    </Text>
  );
});
