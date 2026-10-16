import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';

import { useDownloadsTokens } from '../theme/downloads-tokens';

export type DownloadSectionHeaderProps = {
  title: string;
  count?: number;
  testID?: string;
  /** Shown at the end of the header (H4: the Queued section's Reorder button). */
  action?: import('react').ReactNode;
};

export const DownloadSectionHeader = memo(function DownloadSectionHeader({
  title,
  count,
  testID,
  action,
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
      {action ? (
        <Box
          row
          rtlRow
          center
          style={{ position: 'absolute', top: 0, bottom: 0, end: downloadsTokens.spacing.screenX }}>
          {action}
        </Box>
      ) : null}
    </Box>
  );
});
