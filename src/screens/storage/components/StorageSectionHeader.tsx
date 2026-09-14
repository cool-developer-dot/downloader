import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';

export type StorageSectionHeaderProps = {
  title: string;
  subtitle?: string;
  testID?: string;
};

export const StorageSectionHeader = memo(function StorageSectionHeader({
  title,
  subtitle,
  testID,
}: StorageSectionHeaderProps) {
  return (
    <Box testID={testID} gap={4}>
      <Text variant="subtitle" accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? (
        <Text variant="caption" color="textSecondary">
          {subtitle}
        </Text>
      ) : null}
    </Box>
  );
});
