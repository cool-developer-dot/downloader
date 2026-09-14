import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Button } from '@/components/buttons/Button';
import { EmptyState } from '@/components/common/EmptyState';

export type AnalyzeFallbackStateProps = {
  title: string;
  description: string;
  onOpenVideo: () => void;
  onRetry: () => void;
  testID?: string;
};

export const AnalyzeFallbackState = memo(function AnalyzeFallbackState({
  title,
  description,
  onOpenVideo,
  onRetry,
  testID = 'quality-analyze-fallback',
}: AnalyzeFallbackStateProps) {
  return (
    <Box gap={12} testID={testID}>
      <EmptyState icon="play-circle-outline" title={title} description={description} />
      <Button
        title="Open Video"
        onPress={onOpenVideo}
        fullWidth
        leftIcon="web"
        testID="quality-open-video"
        accessibilityHint="Opens the video in Browser so playback can be detected"
      />
      <Button
        title="Retry"
        variant="outline"
        onPress={onRetry}
        fullWidth
        testID="quality-analyze-retry"
      />
    </Box>
  );
});
