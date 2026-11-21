import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { memo, useEffect, useState } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { browserMediaActionService } from '@/browser/media-actions/browser-media-action.service';
import { DsButton, DsIcon, DsText, ds, dsThumbColors } from '@/design';
import type { DownloadQualityOption } from '@/downloads/quality';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { usePlayerSessionHostStore } from '@/player/session-host/player-session-store';
import { withAlpha } from '@/theme';

/** The design's hero block: full width, 125 dp tall, 16 dp corners. */
export const PREVIEW_HERO_HEIGHT = 125;

const PreviewSurface = memo(function PreviewSurface({ uri, referer }: { uri: string; referer: string | null }) {
  const player = useVideoPlayer({ uri, headers: referer ? { Referer: referer } : undefined }, (created) => {
    created.play();
  });
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: dsThumbColors.video.base, borderRadius: ds.radius.card }}
      testID="quality-download-preview-video"
    />
  );
});

export type DownloadPreviewProps = {
  option: DownloadQualityOption | null;
  /** The analysis' thumbnail, drawn in the hero; the design's dark green block with ▶ without one. */
  thumbnailUrl?: string | null;
  testID?: string;
};

/**
 * Preview Before Download (#381) as the design's hero (design 33): the video's thumbnail (or the dark green ▶ block)
 * over the quality list; a tap streams the chosen quality in a small player right there, the way the page plays
 * it. Nothing is kept — no file, no watch history, no resume position. The app's own player (the mini player) pauses
 * so two videos never play at once; another quality, Close or closing the sheet ends the preview.
 */
export const DownloadPreview = memo(function DownloadPreview({ option, thumbnailUrl, testID = 'quality-download-preview' }: DownloadPreviewProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const uri = option?.downloadable ? option.sourceUrl : null;
  const thumbnail = thumbnailUrl?.trim() || null;

  // Another quality closes the preview: Preview then plays the one now chosen.
  useEffect(() => {
    setOpen(false);
  }, [uri]);

  useEffect(() => {
    if (open) {
      usePlayerSessionHostStore.getState().live?.controller.pause();
    }
  }, [open]);

  if (open && uri) {
    return (
      <View style={{ gap: 8 }} testID={testID}>
        <PreviewSurface key={uri} uri={uri} referer={browserMediaActionService.getState().pageUrl} />
        <DsText variant="rowSub">{t('downloadOptions.previewNote')}</DsText>
        <DsButton
          label={t('downloadOptions.previewClose')}
          variant="secondary"
          icon="x"
          fullWidth
          onPress={() => setOpen(false)}
          accessibilityLabel={t('lightVideoSheet.heroStopA11y')}
          testID="quality-download-preview-toggle"
        />
      </View>
    );
  }

  const hero = (
    <View
      style={{
        height: PREVIEW_HERO_HEIGHT,
        borderRadius: ds.radius.card,
        overflow: 'hidden',
        backgroundColor: dsThumbColors.video.base,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {thumbnail && !imageFailed ? (
        <Image
          source={{ uri: thumbnail }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          contentFit="cover"
          transition={160}
          onError={() => setImageFailed(true)}
          accessibilityLabel={t('mediaResult.thumbnailA11y')}
        />
      ) : (
        <View
          style={{
            position: 'absolute',
            top: -PREVIEW_HERO_HEIGHT,
            left: -60,
            width: 320,
            height: PREVIEW_HERO_HEIGHT * 1.8,
            borderRadius: 160,
            backgroundColor: dsThumbColors.video.light,
            opacity: 0.45,
          }}
        />
      )}
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: thumbnail && !imageFailed ? withAlpha(theme.colors.textPrimary, 0.45) : 'transparent',
        }}>
        <DsIcon name="play" size={30} color="white" strokeWidth={2} />
      </View>
    </View>
  );

  if (!uri) {
    return (
      <View testID={testID} accessibilityRole="image" accessibilityLabel={t('mediaResult.placeholderA11y')}>
        {hero}
      </View>
    );
  }

  return (
    <Pressable
      testID="quality-download-preview-toggle"
      onPress={() => setOpen(true)}
      accessibilityRole="button"
      accessibilityLabel={t('lightVideoSheet.heroPlayA11y')}
      accessibilityHint={t('downloadOptions.previewHint')}>
      {hero}
    </Pressable>
  );
});
