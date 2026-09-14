import { memo, useCallback, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { VideoView, type VideoPlayer } from 'expo-video';

import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import {
  doubleTapSeekDelta,
  resolveCenterDoubleTapSide,
  sideZoneStyle,
  type DoubleTapSeekSide,
} from '@/player';

export type PlayerVideoSurfaceProps = {
  player: VideoPlayer;
  gesturesEnabled?: boolean;
  brightnessGesturesEnabled?: boolean;
  onSingleTap?: () => void;
  onDoubleTapSeek?: (side: DoubleTapSeekSide, deltaSeconds: number) => void;
  onBrightnessPanBegin?: () => void;
  onBrightnessPanUpdate?: (translationY: number) => void;
  onBrightnessPanEnd?: () => void;
  onVolumePanBegin?: () => void;
  onVolumePanUpdate?: (translationY: number) => void;
  onVolumePanEnd?: () => void;
  onSurfaceLayout?: (size: { width: number; height: number }) => void;
  /** Native first painted frame — prefer over readyToPlay for cover dismissal. */
  onFirstFrameRender?: () => void;
};

export const PlayerVideoSurface = memo(function PlayerVideoSurface({
  player,
  gesturesEnabled = true,
  brightnessGesturesEnabled = true,
  onSingleTap,
  onDoubleTapSeek,
  onBrightnessPanBegin,
  onBrightnessPanUpdate,
  onBrightnessPanEnd,
  onVolumePanBegin,
  onVolumePanUpdate,
  onVolumePanEnd,
  onSurfaceLayout,
  onFirstFrameRender,
}: PlayerVideoSurfaceProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [layout, setLayout] = useState({ width: 0, height: 0 });

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout({ width, height });
    onSurfaceLayout?.({ width, height });
  }, [onSurfaceLayout]);

  const handleSingleTap = useCallback(() => {
    onSingleTap?.();
  }, [onSingleTap]);

  const handleDoubleTap = useCallback(
    (localX: number) => {
      const centerWidth = layout.width * 0.5;
      const side = resolveCenterDoubleTapSide(localX, centerWidth);
      if (!side) {
        return;
      }
      onDoubleTapSeek?.(side, doubleTapSeekDelta(side));
    },
    [layout.width, onDoubleTapSeek],
  );

  const handleBrightnessBegin = useCallback(() => {
    onBrightnessPanBegin?.();
  }, [onBrightnessPanBegin]);

  const handleBrightnessUpdate = useCallback(
    (translationY: number) => {
      onBrightnessPanUpdate?.(translationY);
    },
    [onBrightnessPanUpdate],
  );

  const handleBrightnessEnd = useCallback(() => {
    onBrightnessPanEnd?.();
  }, [onBrightnessPanEnd]);

  const handleVolumeBegin = useCallback(() => {
    onVolumePanBegin?.();
  }, [onVolumePanBegin]);

  const handleVolumeUpdate = useCallback(
    (translationY: number) => {
      onVolumePanUpdate?.(translationY);
    },
    [onVolumePanUpdate],
  );

  const handleVolumeEnd = useCallback(() => {
    onVolumePanEnd?.();
  }, [onVolumePanEnd]);

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDuration(280)
        .enabled(gesturesEnabled)
        .onEnd((event) => {
          runOnJS(handleDoubleTap)(event.x);
        }),
    [gesturesEnabled, handleDoubleTap],
  );

  const singleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(1)
        .maxDuration(250)
        .enabled(gesturesEnabled)
        .onEnd(() => {
          runOnJS(handleSingleTap)();
        }),
    [gesturesEnabled, handleSingleTap],
  );

  const centerGestures = useMemo(
    () => Gesture.Exclusive(doubleTap, singleTap),
    [doubleTap, singleTap],
  );

  const brightnessPan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(gesturesEnabled && brightnessGesturesEnabled)
        .activeOffsetY([-10, 10])
        .failOffsetX([-16, 16])
        .onBegin(() => {
          runOnJS(handleBrightnessBegin)();
        })
        .onUpdate((event) => {
          runOnJS(handleBrightnessUpdate)(event.translationY);
        })
        .onEnd(() => {
          runOnJS(handleBrightnessEnd)();
        }),
    [
      brightnessGesturesEnabled,
      gesturesEnabled,
      handleBrightnessBegin,
      handleBrightnessEnd,
      handleBrightnessUpdate,
    ],
  );

  const volumePan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(gesturesEnabled)
        .activeOffsetY([-10, 10])
        .failOffsetX([-16, 16])
        .onBegin(() => {
          runOnJS(handleVolumeBegin)();
        })
        .onUpdate((event) => {
          runOnJS(handleVolumeUpdate)(event.translationY);
        })
        .onEnd(() => {
          runOnJS(handleVolumeEnd)();
        }),
    [
      gesturesEnabled,
      handleVolumeBegin,
      handleVolumeEnd,
      handleVolumeUpdate,
    ],
  );

  const zoneBase = useMemo(
    () => ({
      position: 'absolute' as const,
      top: 0,
      bottom: 0,
    }),
    [],
  );

  return (
    <View
      style={[styles.surface, { backgroundColor: theme.colors.black }]}
      onLayout={onLayout}
      accessibilityLabel={t('player.videoSurfaceA11y')}
      accessibilityHint={t('player.surfaceHint')}>
      <VideoView
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls={false}
        fullscreenOptions={{ enable: false }}
        pointerEvents="none"
        onFirstFrameRender={onFirstFrameRender}
      />

      <GestureDetector gesture={brightnessPan}>
        <View
          style={[zoneBase, sideZoneStyle('brightness')]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </GestureDetector>

      <GestureDetector gesture={centerGestures}>
        <View
          style={[zoneBase, sideZoneStyle('center')]}
          accessibilityRole="button"
          accessibilityLabel={t('player.videoSurfaceA11y')}
        />
      </GestureDetector>

      <GestureDetector gesture={volumePan}>
        <View
          style={[zoneBase, sideZoneStyle('volume')]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </GestureDetector>
    </View>
  );
});

const styles = StyleSheet.create({
  surface: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
  },
  video: {
    ...StyleSheet.absoluteFill,
  },
});
