import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { IconButton } from '@/components/buttons/IconButton';
import { Loader } from '@/components/common/Loader';
import { useTranslation } from '@/localization';
import { formatPlaybackRateLabel } from '@/player';
import { resolveVolumeIcon } from '@/player/volume-icons';

export type PlayerControlsProps = {
  isPlaying: boolean;
  isReady: boolean;
  isLoading: boolean;
  isCompleted: boolean;
  isMuted: boolean;
  volumeLevel: number;
  playbackRate: number;
  disabled?: boolean;
  visible?: boolean;
  onPlayPause: () => void;
  onRewind: () => void;
  onForward: () => void;
  onReplay: () => void;
  onToggleMute: () => void;
  onOpenSpeed: () => void;
};

export const PlayerControls = memo(function PlayerControls({
  isPlaying,
  isReady,
  isLoading,
  isCompleted,
  isMuted,
  volumeLevel,
  playbackRate,
  disabled = false,
  visible = true,
  onPlayPause,
  onRewind,
  onForward,
  onReplay,
  onToggleMute,
  onOpenSpeed,
}: PlayerControlsProps) {
  const { t } = useTranslation();
  if (!visible) {
    return null;
  }

  const controlsDisabled = disabled || (!isReady && !isCompleted) || isLoading;
  const volumeIcon = resolveVolumeIcon(volumeLevel, isMuted);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Box row center gap={16} style={styles.row}>
        <IconButton
          icon={volumeIcon}
          size="medium"
          variant="ghost"
          // Video stage is always black — theme primary is ink in LIGHT and vanishes.
          color={controlsDisabled ? 'disabled' : 'inverse'}
          accessibilityLabel={isMuted ? t('player.unmute') : t('player.mute')}
          disabled={controlsDisabled}
          onPress={onToggleMute}
        />
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
        <IconButton
          icon="play-speed"
          size="medium"
          variant="ghost"
          color={controlsDisabled ? 'disabled' : 'inverse'}
          accessibilityLabel={t('player.playbackSpeedSelected', {
            rate: formatPlaybackRateLabel(playbackRate),
          })}
          disabled={controlsDisabled}
          onPress={onOpenSpeed}
        />
      </Box>
      <View style={styles.rateHint} pointerEvents="none">
        <Text variant="caption" color="white">
          {formatPlaybackRateLabel(playbackRate)}
        </Text>
      </View>
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
  rateHint: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    opacity: 0.85,
  },
});
