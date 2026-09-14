import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';

import type { AudioExtractionOption } from '../quality';

export type AudioOptionsRowProps = {
  options: AudioExtractionOption[];
  compact?: boolean;
  testID?: string;
};

/**
 * Displays deduplicated audio formats. Extraction deferred to later phases.
 */
export const AudioOptionsRow = memo(function AudioOptionsRow({
  options,
  compact = false,
  testID = 'audio-options-row',
}: AudioOptionsRowProps) {
  const theme = useTheme();

  if (!options.length) {
    return null;
  }

  return (
    <Box testID={testID} gap={compact ? 4 : 8}>
      {!compact ? (
        <Text variant="caption" color="textSecondary">
          Audio available
        </Text>
      ) : (
        <Text variant="caption" color="textSecondary">
          Audio
        </Text>
      )}
      <Box row style={{ flexWrap: 'wrap', gap: theme.spacing[4] }}>
        {options.map((option) => (
          <Box
            key={option.id}
            accessibilityRole="text"
            accessibilityLabel={`${option.label} audio`}
            style={{
              paddingHorizontal: theme.spacing[8],
              paddingVertical: compact ? theme.spacing[4] : theme.spacing[8],
              borderRadius: theme.radius.sm,
              backgroundColor: theme.colors.success + '18',
              borderWidth: 1,
              borderColor: theme.colors.success,
            }}>
            <Text
              variant="caption"
              style={{ color: theme.colors.success, fontWeight: '600' }}>
              {option.label}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
});
