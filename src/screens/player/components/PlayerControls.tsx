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
};

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
}: PlayerControlsProps) {
  const { t } = useTranslation();
  if (!visible) {
    return null;
  }

  const controlsDisabled = disabled || (!isReady && !isCompleted) || isLoading;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Box row center gap={12} style={styles.row}>
        {hasQueue ? (
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
        <IconButton
          icon="rewind-10"
          size="large"
          variant="ghost"
          color={controlsDisabled ? 'disabled' : 'inverse'}
          accessibilityLabel={t('player.rewind')}
          disabled={controlsDisabled}
          onPress={onRewind}
        />
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
        <IconButton
          icon="fast-forward-10"
          size="large"
          variant="ghost"
          color={controlsDisabled ? 'disabled' : 'inverse'}
          accessibilityLabel={t('player.forward')}
          disabled={controlsDisabled}
          onPress={onForward}
        />
        {hasQueue ? (
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
