import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';

import { useDownloadsTokens } from '../theme/downloads-tokens';

export type DownloadSectionHeaderProps = {
  title: string;
  count?: number;
  testID?: string;
};

export const DownloadSectionHeader = memo(function DownloadSectionHeader({
  title,
  count,
  testID,
}: DownloadSectionHeaderProps) {
  const downloadsTokens = useDownloadsTokens();
  const label = typeof count === 'number' ? `${title} · ${count}` : title;

  return (
    <Box
      testID={testID}
      px={downloadsTokens.spacing.screenX}
      style={{
        paddingTop: downloadsTokens.spacing.sectionTop,
        paddingBottom: downloadsTokens.spacing.sectionBottom,
        backgroundColor: downloadsTokens.background,
      }}
      accessibilityRole="header"
      accessibilityLabel={label}>
      <Text
        variant="label"
        color="textSecondary"
        style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {label}
      </Text>
    </Box>
  );
});
