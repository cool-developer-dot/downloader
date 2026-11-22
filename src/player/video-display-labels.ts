/**
 * P2: the words for each fit and mirror mode, shared by the options sheet rows and the Player's sheets.
 */

import type { TranslateFn, TranslationKey } from '@/localization';

import { isRatioFit, type MirrorMode, type VideoFit, type VideoInfoRowKey } from './video-display';

const FIT_LABELS: Record<Exclude<VideoFit, `${number}:${number}`>, TranslationKey> = {
  fit: 'videoPlayer.fitFit',
  crop: 'videoPlayer.fitCrop',
  stretch: 'videoPlayer.fitStretch',
};

/** "Fit to screen", "Crop to fill", "Stretch", "Ratio 16:9". */
export function videoFitLabel(t: TranslateFn, fit: VideoFit): string {
  return isRatioFit(fit) ? t('videoPlayer.fitRatio', { ratio: fit }) : t(FIT_LABELS[fit]);
}

const MIRROR_LABELS: Record<MirrorMode, TranslationKey> = {
  none: 'videoPlayer.mirrorNone',
  horizontal: 'videoPlayer.mirrorHorizontal',
  vertical: 'videoPlayer.mirrorVertical',
  both: 'videoPlayer.mirrorBoth',
};

export function mirrorModeLabel(t: TranslateFn, mode: MirrorMode): string {
  return t(MIRROR_LABELS[mode]);
}

export const VIDEO_INFO_LABELS: Record<VideoInfoRowKey, TranslationKey> = {
  codec: 'videoPlayer.infoCodec',
  resolution: 'videoPlayer.infoResolution',
  frameRate: 'videoPlayer.infoFrameRate',
  bitrate: 'videoPlayer.infoBitrate',
  range: 'videoPlayer.infoRange',
  speed: 'videoPlayer.infoSpeed',
};
