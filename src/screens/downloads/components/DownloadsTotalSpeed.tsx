import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { useTranslation } from '@/localization';

import { useTotalDownloadSpeed } from '../hooks/useDownloadProgressDetails';
import { useDownloadsTokens } from '../theme/downloads-tokens';

/** Total Speed Overview (#322): the running v2 downloads' combined speed. Hidden while none is known. */
export const DownloadsTotalSpeed = memo(function DownloadsTotalSpeed({
  testID = 'downloads-total-speed',
}: {
  testID?: string;
}) {
  const downloadsTokens = useDownloadsTokens();
  const { t } = useTranslation();
  const speed = useTotalDownloadSpeed();

  if (!speed) {
    return null;
  }

  const label = t('downloadProgress.totalSpeed', { speed });
  return (
    <Box
      row
      gap={6}
      px={downloadsTokens.spacing.screenX}
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{ alignItems: 'center' }}>
      <Icon name="speedometer" size="sm" color="secondary" />
      <Text variant="caption" color="textSecondary" numberOfLines={1}>
        {label}
      </Text>
    </Box>
  );
});
