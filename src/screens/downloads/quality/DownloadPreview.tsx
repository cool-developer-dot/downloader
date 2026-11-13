import { useVideoPlayer, VideoView } from 'expo-video';
import { memo, useEffect, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { browserMediaActionService } from '@/browser/media-actions/browser-media-action.service';
import type { DownloadQualityOption } from '@/downloads/quality';
import { useTranslation } from '@/localization';
import { usePlayerSessionHostStore } from '@/player/session-host/player-session-store';

const PreviewSurface = memo(function PreviewSurface({ uri, referer }: { uri: string; referer: string | null }) {
  const player = useVideoPlayer({ uri, headers: referer ? { Referer: referer } : undefined }, (created) => {
    created.play();
  });
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 12 }}
      testID="quality-download-preview-video"
    />
  );
});

/**
 * Preview Before Download (#381): a glimpse of the chosen quality in a small player inside the quality sheet, streamed
 * from the site the way the page plays it. Nothing is kept — no file, no watch history, no resume position. The app's
 * own player (the mini player) pauses so two videos never play at once; another quality, Close or closing the sheet
 * ends the preview.
 */
export const DownloadPreview = memo(function DownloadPreview({ option }: { option: DownloadQualityOption | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const uri = option?.downloadable ? option.sourceUrl : null;

  // Another quality closes the preview: Preview then plays the one now chosen.
  useEffect(() => {
    setOpen(false);
  }, [uri]);

  useEffect(() => {
    if (open) {
      usePlayerSessionHostStore.getState().live?.controller.pause();
    }
  }, [open]);

  if (!uri) {
    return null;
  }

  return (
    <Box gap={8}>
      <Button
        title={open ? t('downloadOptions.previewClose') : t('downloadOptions.preview')}
        variant="outline"
        size="small"
        leftIcon={open ? 'close' : 'play-circle-outline'}
        onPress={() => setOpen((value) => !value)}
        accessibilityHint={t('downloadOptions.previewHint')}
        testID="quality-download-preview-toggle"
      />
      {open ? (
        <Box gap={4}>
          <PreviewSurface key={uri} uri={uri} referer={browserMediaActionService.getState().pageUrl} />
          <Text variant="caption" color="textSecondary">
            {t('downloadOptions.previewNote')}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
});
