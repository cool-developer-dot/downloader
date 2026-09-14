import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { formatPlaybackTime } from '@/player';
import { useTranslation } from '@/localization';

export type PlayerTimelineProps = {
  positionSeconds: number;
  durationSeconds: number | null;
  previewSeconds: number | null;
  disabled?: boolean;
  onSeekStart: (seconds: number) => void;
  onSeekChange: (seconds: number) => void;
  onSeekCommit: () => void;
  onSeekCancel: () => void;
};

function ratioToSeconds(
  x: number,
  width: number,
  duration: number,
): number {
  if (width <= 0 || duration <= 0) {
    return 0;
  }
  const ratio = Math.max(0, Math.min(1, x / width));
  return ratio * duration;
}

export const PlayerTimeline = memo(function PlayerTimeline({
  positionSeconds,
  durationSeconds,
  previewSeconds,
  disabled = false,
  onSeekStart,
  onSeekChange,
  onSeekCommit,
  onSeekCancel,
}: PlayerTimelineProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [trackWidth, setTrackWidth] = useState(0);
  const scrubbingRef = useRef(false);
  // Timeline sits on a fixed dark dock over video. LIGHT primary is ink and
  // vanishes; keep progress readable in light / logo / dark.
  const progressColor =
    theme.mode === 'light' ? theme.colors.white : theme.colors.primary;

  const displaySeconds =
    previewSeconds != null ? previewSeconds : positionSeconds;
  const duration =
    durationSeconds != null && durationSeconds > 0 ? durationSeconds : null;
  const progress =
    duration != null && duration > 0
      ? Math.max(0, Math.min(1, displaySeconds / duration))
      : 0;

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);

  const startAt = useCallback(
    (x: number) => {
      if (disabled || duration == null) {
        return;
      }
      scrubbingRef.current = true;
      onSeekStart(ratioToSeconds(x, trackWidth, duration));
    },
    [disabled, duration, onSeekStart, trackWidth],
  );

  const changeAt = useCallback(
    (x: number) => {
      if (!scrubbingRef.current || disabled || duration == null) {
        return;
      }
      onSeekChange(ratioToSeconds(x, trackWidth, duration));
    },
    [disabled, duration, onSeekChange, trackWidth],
  );

  const commit = useCallback(() => {
    if (!scrubbingRef.current) {
      return;
    }
    scrubbingRef.current = false;
    onSeekCommit();
  }, [onSeekCommit]);

  const cancel = useCallback(() => {
    if (!scrubbingRef.current) {
      return;
    }
    scrubbingRef.current = false;
    onSeekCancel();
  }, [onSeekCancel]);

  const seekToX = useCallback(
    (x: number) => {
      if (disabled || duration == null) {
        return;
      }
      const seconds = ratioToSeconds(x, trackWidth, duration);
      scrubbingRef.current = true;
      onSeekStart(seconds);
      scrubbingRef.current = false;
      onSeekCommit();
    },
    [disabled, duration, onSeekCommit, onSeekStart, trackWidth],
  );

  const pan = useMemo(() => {
    return Gesture.Pan()
      .enabled(!disabled && duration != null)
      .onBegin((event) => {
        runOnJS(startAt)(event.x);
      })
      .onUpdate((event) => {
        runOnJS(changeAt)(event.x);
      })
      .onEnd(() => {
        runOnJS(commit)();
      })
      .onFinalize((_, success) => {
        if (!success) {
          runOnJS(cancel)();
        }
      });
  }, [cancel, changeAt, commit, disabled, duration, startAt]);

  const tap = useMemo(() => {
    return Gesture.Tap()
      .enabled(!disabled && duration != null)
      .onEnd((event) => {
        runOnJS(seekToX)(event.x);
      });
  }, [disabled, duration, seekToX]);

  const gesture = useMemo(
    () => Gesture.Exclusive(pan, tap),
    [pan, tap],
  );

  return (
    <Box gap={8} style={styles.wrap}>
      <GestureDetector gesture={gesture}>
        <View
          style={styles.hit}
          onLayout={onLayout}
          accessibilityRole="adjustable"
          accessibilityLabel={t('player.seekTimelineA11y')}
          accessibilityValue={{
            min: 0,
            max: duration ?? 0,
            now: displaySeconds,
          }}>
          <View
            style={[
              styles.track,
              {
                // Fixed light track on dark dock — readable in all themes.
                backgroundColor: 'rgba(255,255,255,0.28)',
              },
            ]}>
            <View
              style={[
                styles.fill,
                {
                  width: `${progress * 100}%`,
                  backgroundColor: progressColor,
                },
              ]}
            />
            <View
              style={[
                styles.thumb,
                {
                  left: `${progress * 100}%`,
                  backgroundColor: progressColor,
                  borderColor: theme.colors.white,
                },
              ]}
            />
          </View>
        </View>
      </GestureDetector>
      <Box row style={styles.times}>
        <Text variant="caption" color="white">
          {formatPlaybackTime(displaySeconds)}
        </Text>
        <Text variant="caption" color="white">
          {formatPlaybackTime(duration)}
        </Text>
      </Box>
    </Box>
  );
});

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  hit: {
    height: 44,
    justifyContent: 'center',
  },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: 'visible',
    width: '100%',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 2,
  },
  thumb: {
    position: 'absolute',
    top: -6,
    marginLeft: -8,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
  },
  times: {
    width: '100%',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
