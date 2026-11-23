import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Box } from '@/components/base/Box';
import { IconButton } from '@/components/buttons/IconButton';
import { Loader } from '@/components/common/Loader';
import { useTranslation } from '@/localization';

export type PlayerControlsProps = {
  isPlaying: boolean;
  isReady: boolean;
  isLoading: boolean;
  isCompleted: boolean;
  disabled?: boolean;
  visible?: boolean;
  /** Previous / Next show only when the video was opened from a list; each is null at that end of it. */
  hasQueue?: boolean;
  onPrevious?: (() => void) | null;
  onNext?: (() => void) | null;
  onPlayPause: () => void;
  onRewind: () => void;
  onForward: () => void;
  onReplay: () => void;
  /** The chosen seek interval (P1 #527): the ⏪ / ⏩ icons and labels follow it. */
  seekStepSeconds?: number;
  /** P8 #692: the ⏪ / ⏩ pair is shown (default). */
  showSkipButtons?: boolean;
  /** P8 #692: ⏮ / ⏭ are shown when there is a list (default). */
  showPreviousNext?: boolean;
};

/** The icon font has numbered skip glyphs for these intervals only; others show the plain ⏪ / ⏩. */
const NUMBERED_SKIP_ICONS = new Set([5, 10, 15, 30, 45, 60]);

export const PlayerControls = memo(function PlayerControls({
  isPlaying,
  isReady,
  isLoading,
  isCompleted,
  disabled = false,
  visible = true,
  hasQueue = false,
  onPrevious = null,
  onNext = null,
  onPlayPause,
  onRewind,
  onForward,
  onReplay,
  seekStepSeconds = 10,
  showSkipButtons = true,
  showPreviousNext = true,
}: PlayerControlsProps) {
  const { t } = useTranslation();
  if (!visible) {
    return null;
  }

  const controlsDisabled = disabled || (!isReady && !isCompleted) || isLoading;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Box row center gap={12} style={styles.row}>
        {hasQueue && showPreviousNext ? (
          <IconButton
            icon="skip-previous"
            size="medium"
            variant="ghost"
            // Video stage is always black — theme primary is ink in LIGHT and vanishes.
            color={onPrevious ? 'inverse' : 'disabled'}
            accessibilityLabel={t('player.previousVideo')}
            disabled={!onPrevious}
            onPress={onPrevious ?? undefined}
            testID="player-previous"
          />
        ) : null}
        {showSkipButtons ? (
          <IconButton
            icon={NUMBERED_SKIP_ICONS.has(seekStepSeconds) ? `rewind-${seekStepSeconds}` : 'rewind'}
            size="large"
            variant="ghost"
            color={controlsDisabled ? 'disabled' : 'inverse'}
            accessibilityLabel={t('videoPlayer.rewindSeconds', { seconds: seekStepSeconds })}
            disabled={controlsDisabled}
            onPress={onRewind}
          />
        ) : null}
        <View style={styles.playWrap}>
          {isLoading ? (
            <Loader size="large" accessibilityLabel={t('player.preparing')} />
          ) : isCompleted ? (
            <IconButton
              icon="replay"
              size="large"
              variant="primary"
              accessibilityLabel={t('player.replay')}
              onPress={onReplay}
            />
          ) : (
            <IconButton
              icon={isPlaying ? 'pause' : 'play'}
              size="large"
              variant="primary"
              accessibilityLabel={isPlaying ? t('player.pause') : t('player.play')}
              disabled={controlsDisabled && !isReady}
              onPress={onPlayPause}
            />
          )}
        </View>
        {showSkipButtons ? (
          <IconButton
            icon={NUMBERED_SKIP_ICONS.has(seekStepSeconds) ? `fast-forward-${seekStepSeconds}` : 'fast-forward'}
            size="large"
            variant="ghost"
            color={controlsDisabled ? 'disabled' : 'inverse'}
            accessibilityLabel={t('videoPlayer.forwardSeconds', { seconds: seekStepSeconds })}
            disabled={controlsDisabled}
            onPress={onForward}
          />
        ) : null}
        {hasQueue && showPreviousNext ? (
          <IconButton
            icon="skip-next"
            size="medium"
            variant="ghost"
            color={onNext ? 'inverse' : 'disabled'}
            accessibilityLabel={t('player.nextVideo')}
            disabled={!onNext}
            onPress={onNext ?? undefined}
            testID="player-next"
          />
        ) : null}
      </Box>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  row: {
    paddingHorizontal: 8,
  },
  playWrap: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
