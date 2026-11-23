import { memo, useMemo } from 'react';

import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { useTranslation } from '@/localization';
import { MIRROR_MODES, VIDEO_FITS, type MirrorMode, type VideoFit } from '@/player/video-display';
import { mirrorModeLabel, videoFitLabel } from '@/player/video-display-labels';

export type AspectRatioSheetProps = {
  visible: boolean;
  selected: VideoFit;
  onSelect: (fit: VideoFit) => void;
  onClose: () => void;
};

/**
 * P2 #564 Aspect ratio, #565 Crop to fill, #566 Stretch: how the picture fills the screen, remembered for this video.
 * Opened by the "Aspect ratio" tile and the options sheet's Video section.
 */
export const AspectRatioSheet = memo(function AspectRatioSheet({ visible, selected, onSelect, onClose }: AspectRatioSheetProps) {
  const { t } = useTranslation();
  const actions = useMemo<ActionSheetItem[]>(
    () =>
      VIDEO_FITS.map((fit) => ({
        id: `video-fit-${fit.replace(':', 'x')}`,
        label: videoFitLabel(t, fit),
        selected: fit === selected,
        onPress: () => onSelect(fit),
      })),
    [onSelect, selected, t],
  );
  return (
    <ActionSheetModal
      visible={visible}
      title={t('videoPlayer.tileAspectRatio')}
      subtitle={t('videoPlayer.fitSheetSubtitle')}
      actions={actions}
      onClose={onClose}
      testID="player-aspect-ratio-sheet"
    />
  );
});

export type MirrorFlipSheetProps = {
  visible: boolean;
  selected: MirrorMode;
  onSelect: (mode: MirrorMode) => void;
  onClose: () => void;
};

/** P2 #573 Mirror / Flip: the picture left ↔ right, upside down, or both, for the video playing now. */
export const MirrorFlipSheet = memo(function MirrorFlipSheet({ visible, selected, onSelect, onClose }: MirrorFlipSheetProps) {
  const { t } = useTranslation();
  const actions = useMemo<ActionSheetItem[]>(
    () =>
      MIRROR_MODES.map((mode) => ({
        id: `video-mirror-${mode}`,
        label: mirrorModeLabel(t, mode),
        selected: mode === selected,
        onPress: () => onSelect(mode),
      })),
    [onSelect, selected, t],
  );
  return (
    <ActionSheetModal
      visible={visible}
      title={t('videoPlayer.tileMirrorFlip')}
      subtitle={t('videoPlayer.mirrorSheetSubtitle')}
      actions={actions}
      onClose={onClose}
      testID="player-mirror-flip-sheet"
    />
  );
});
