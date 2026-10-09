import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withTiming,
} from 'react-native-reanimated';
import { useEventListener } from 'expo';
import { VideoView, type VideoPlayer } from 'expo-video';

import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import {
  doubleTapSeekDelta,
  resolveCenterDoubleTapSide,
  SIDE_ZONE_RATIO,
  type DoubleTapSeekSide,
} from '@/player';
import {
  anchoredTranslation,
  clampTranslation,
  fittedContentSize,
  isZoomed,
  maxTranslation,
  rubberBandScale,
  rubberBandTranslation,
  settleScale,
  settleTranslation,
  type Size,
} from '@/player/zoom-math';

const SETTLE = { duration: 180 };

export type PlayerVideoSurfaceProps = {
  player: VideoPlayer;
  gesturesEnabled?: boolean;
  brightnessGesturesEnabled?: boolean;
  onSingleTap?: () => void;
  onDoubleTapSeek?: (side: DoubleTapSeekSide, deltaSeconds: number) => void;
  onBrightnessPanStart?: () => void;
  onBrightnessPanUpdate?: (translationY: number) => void;
  onBrightnessPanFinalize?: () => void;
  onVolumePanStart?: () => void;
  onVolumePanUpdate?: (translationY: number) => void;
  onVolumePanFinalize?: () => void;
  /** Zoom level while pinching, in percent of the fitted size. */
  onZoomChange?: (percent: number) => void;
  onZoomFinalize?: () => void;
  /** A new value (a new video) puts the picture back to fitted. */
  zoomResetKey?: string | number;
  /** The picture as displayed (rotation applied), when known; otherwise the playing track's size is used. */
  contentSize?: Size | null;
  /** Arms the automatic picture-in-picture window for when the user leaves VidoraX. */
  pictureInPictureAutoEnter?: boolean;
  onPictureInPictureStart?: () => void;
  onPictureInPictureStop?: () => void;
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
  onBrightnessPanStart,
  onBrightnessPanUpdate,
  onBrightnessPanFinalize,
  onVolumePanStart,
  onVolumePanUpdate,
  onVolumePanFinalize,
  onZoomChange,
  onZoomFinalize,
  zoomResetKey,
  contentSize,
  pictureInPictureAutoEnter = false,
  onPictureInPictureStart,
  onPictureInPictureStop,
  onSurfaceLayout,
  onFirstFrameRender,
}: PlayerVideoSurfaceProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [layout, setLayout] = useState<Size>({ width: 0, height: 0 });
  const [trackSize, setTrackSize] = useState<Size | null>(() => player.videoTrack?.size ?? null);
  /** Mirrors the settled zoom: gates which one-finger drag is active (pan the picture vs. brightness/volume). */
  const [zoomed, setZoomed] = useState(false);

  useEventListener(player, 'videoTrackChange', ({ videoTrack }) => {
    setTrackSize(videoTrack?.size ?? null);
  });

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const surfaceWidth = useSharedValue(0);
  const surfaceHeight = useSharedValue(0);
  const contentWidth = useSharedValue(0);
  const contentHeight = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startFocalX = useSharedValue(0);
  const startFocalY = useSharedValue(0);
  const pinching = useSharedValue(false);
  const lastZoomPercent = useSharedValue(100);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      setLayout({ width, height });
      onSurfaceLayout?.({ width, height });
    },
    [onSurfaceLayout],
  );

  // Geometry the gestures clamp against: the surface, and the picture as fitted in it.
  const picture = contentSize ?? trackSize;
  useEffect(() => {
    const fitted = fittedContentSize(layout, picture);
    surfaceWidth.value = layout.width;
    surfaceHeight.value = layout.height;
    contentWidth.value = fitted.width;
    contentHeight.value = fitted.height;
    // A rotation or fullscreen change keeps the zoom but must not leave the picture off its new bounds.
    if (isZoomed(scale.value)) {
      const settled = settleTranslation(
        { x: translateX.value, y: translateY.value },
        layout,
        fitted,
        scale.value,
      );
      translateX.value = withTiming(settled.x, SETTLE);
      translateY.value = withTiming(settled.y, SETTLE);
    }
  }, [
    contentHeight,
    contentWidth,
    layout,
    picture,
    scale,
    surfaceHeight,
    surfaceWidth,
    translateX,
    translateY,
  ]);

  const resetZoom = useCallback(() => {
    cancelAnimation(scale);
    cancelAnimation(translateX);
    cancelAnimation(translateY);
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    lastZoomPercent.value = 100;
    setZoomed(false);
  }, [lastZoomPercent, scale, translateX, translateY]);

  // Every new video starts fitted.
  useEffect(() => {
    resetZoom();
  }, [resetZoom, zoomResetKey]);

  const handleSingleTap = useCallback(() => {
    onSingleTap?.();
  }, [onSingleTap]);

  const handleDoubleTap = useCallback(
    (localX: number) => {
      const side = resolveCenterDoubleTapSide(localX, layout.width);
      if (!side) {
        return;
      }
      onDoubleTapSeek?.(side, doubleTapSeekDelta(side));
    },
    [layout.width, onDoubleTapSeek],
  );

  const handleZoomChange = useCallback(
    (percent: number) => {
      onZoomChange?.(percent);
    },
    [onZoomChange],
  );

  const handleZoomFinalize = useCallback(() => {
    onZoomFinalize?.();
  }, [onZoomFinalize]);

  const noop = useCallback(() => {}, []);
  const brightnessStart = onBrightnessPanStart ?? noop;
  const brightnessFinalize = onBrightnessPanFinalize ?? noop;
  const volumeStart = onVolumePanStart ?? noop;
  const volumeFinalize = onVolumePanFinalize ?? noop;
  const brightnessUpdate = useCallback(
    (translationY: number) => onBrightnessPanUpdate?.(translationY),
    [onBrightnessPanUpdate],
  );
  const volumeUpdate = useCallback(
    (translationY: number) => onVolumePanUpdate?.(translationY),
    [onVolumePanUpdate],
  );

  const gesture = useMemo(() => {
    const zoneWidth = Math.max(0, layout.width * SIDE_ZONE_RATIO);

    const pinch = Gesture.Pinch()
      .enabled(gesturesEnabled)
      .onStart((event) => {
        cancelAnimation(scale);
        cancelAnimation(translateX);
        cancelAnimation(translateY);
        pinching.value = true;
        startScale.value = scale.value;
        startX.value = translateX.value;
        startY.value = translateY.value;
        startFocalX.value = event.focalX - surfaceWidth.value / 2;
        startFocalY.value = event.focalY - surfaceHeight.value / 2;
      })
      .onUpdate((event) => {
        const next = rubberBandScale(startScale.value * event.scale);
        scale.value = next;
        translateX.value = anchoredTranslation(
          event.focalX - surfaceWidth.value / 2,
          startFocalX.value,
          startX.value,
          startScale.value,
          next,
        );
        translateY.value = anchoredTranslation(
          event.focalY - surfaceHeight.value / 2,
          startFocalY.value,
          startY.value,
          startScale.value,
          next,
        );
        const percent = Math.round(next * 100);
        if (percent !== lastZoomPercent.value) {
          lastZoomPercent.value = percent;
          runOnJS(handleZoomChange)(percent);
        }
      })
      .onEnd(() => {
        const target = settleScale(scale.value);
        const settled = settleTranslation(
          { x: translateX.value, y: translateY.value },
          { width: surfaceWidth.value, height: surfaceHeight.value },
          { width: contentWidth.value, height: contentHeight.value },
          target,
        );
        scale.value = withTiming(target, SETTLE);
        translateX.value = withTiming(settled.x, SETTLE);
        translateY.value = withTiming(settled.y, SETTLE);
        const percent = Math.round(target * 100);
        lastZoomPercent.value = percent;
        runOnJS(handleZoomChange)(percent);
        runOnJS(setZoomed)(isZoomed(target));
      })
      .onFinalize(() => {
        pinching.value = false;
        runOnJS(handleZoomFinalize)();
      });

    // One finger moves the zoomed picture; it glides and stops at the picture's edges.
    const zoomPan = Gesture.Pan()
      .enabled(gesturesEnabled && zoomed)
      .maxPointers(1)
      .onStart(() => {
        cancelAnimation(translateX);
        cancelAnimation(translateY);
        startX.value = translateX.value;
        startY.value = translateY.value;
      })
      .onUpdate((event) => {
        if (pinching.value) {
          return;
        }
        const maxX = maxTranslation(surfaceWidth.value, contentWidth.value, scale.value);
        const maxY = maxTranslation(surfaceHeight.value, contentHeight.value, scale.value);
        translateX.value = rubberBandTranslation(startX.value + event.translationX, maxX);
        translateY.value = rubberBandTranslation(startY.value + event.translationY, maxY);
      })
      .onEnd((event) => {
        if (pinching.value) {
          return;
        }
        const maxX = maxTranslation(surfaceWidth.value, contentWidth.value, scale.value);
        const maxY = maxTranslation(surfaceHeight.value, contentHeight.value, scale.value);
        translateX.value =
          Math.abs(translateX.value) > maxX
            ? withTiming(clampTranslation(translateX.value, maxX), SETTLE)
            : withDecay({ velocity: event.velocityX, clamp: [-maxX, maxX] });
        translateY.value =
          Math.abs(translateY.value) > maxY
            ? withTiming(clampTranslation(translateY.value, maxY), SETTLE)
            : withDecay({ velocity: event.velocityY, clamp: [-maxY, maxY] });
      });

    // Edge swipes (fitted picture only): left = brightness, right = volume. A tap or a sideways move never starts
    // them; `onFinalize` runs for every touch they saw, so the indicator can never be left behind.
    const brightnessPan = Gesture.Pan()
      .enabled(gesturesEnabled && brightnessGesturesEnabled && !zoomed && zoneWidth > 0)
      .hitSlop({ left: 0, width: zoneWidth })
      .maxPointers(1)
      .activeOffsetY([-10, 10])
      .failOffsetX([-16, 16])
      .onStart(() => {
        runOnJS(brightnessStart)();
      })
      .onUpdate((event) => {
        runOnJS(brightnessUpdate)(event.translationY);
      })
      .onFinalize(() => {
        runOnJS(brightnessFinalize)();
      });

    const volumePan = Gesture.Pan()
      .enabled(gesturesEnabled && !zoomed && zoneWidth > 0)
      .hitSlop({ right: 0, width: zoneWidth })
      .maxPointers(1)
      .activeOffsetY([-10, 10])
      .failOffsetX([-16, 16])
      .onStart(() => {
        runOnJS(volumeStart)();
      })
      .onUpdate((event) => {
        runOnJS(volumeUpdate)(event.translationY);
      })
      .onFinalize(() => {
        runOnJS(volumeFinalize)();
      });

    // Double tap: back to fitted while zoomed, otherwise seek by the side tapped.
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(280)
      .enabled(gesturesEnabled)
      .onEnd((event, success) => {
        if (!success) {
          return;
        }
        if (isZoomed(scale.value)) {
          scale.value = withTiming(1, SETTLE);
          translateX.value = withTiming(0, SETTLE);
          translateY.value = withTiming(0, SETTLE);
          lastZoomPercent.value = 100;
          runOnJS(setZoomed)(false);
          return;
        }
        runOnJS(handleDoubleTap)(event.x);
      });

    const singleTap = Gesture.Tap()
      .numberOfTaps(1)
      .maxDuration(250)
      .enabled(gesturesEnabled)
      .onEnd((_event, success) => {
        if (success) {
          runOnJS(handleSingleTap)();
        }
      });

    return Gesture.Race(
      Gesture.Simultaneous(pinch, zoomPan),
      brightnessPan,
      volumePan,
      Gesture.Exclusive(doubleTap, singleTap),
    );
  }, [
    brightnessFinalize,
    brightnessGesturesEnabled,
    brightnessStart,
    brightnessUpdate,
    contentHeight,
    contentWidth,
    gesturesEnabled,
    handleDoubleTap,
    handleSingleTap,
    handleZoomChange,
    handleZoomFinalize,
    lastZoomPercent,
    layout.width,
    pinching,
    scale,
    startFocalX,
    startFocalY,
    startScale,
    startX,
    startY,
    surfaceHeight,
    surfaceWidth,
    translateX,
    translateY,
    volumeFinalize,
    volumeStart,
    volumeUpdate,
    zoomed,
  ]);

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View
      style={[styles.surface, { backgroundColor: theme.colors.black }]}
      onLayout={onLayout}>
      <Animated.View style={[styles.video, zoomStyle]} pointerEvents="none">
        <VideoView
          player={player}
          style={styles.video}
          contentFit="contain"
          nativeControls={false}
          fullscreenOptions={{ enable: false }}
          // Drawn in the view hierarchy, so zoom transforms and the surface's clipping apply exactly.
          surfaceType="textureView"
          allowsPictureInPicture
          startsPictureInPictureAutomatically={pictureInPictureAutoEnter}
          onPictureInPictureStart={onPictureInPictureStart}
          onPictureInPictureStop={onPictureInPictureStop}
          pointerEvents="none"
          onFirstFrameRender={onFirstFrameRender}
        />
      </Animated.View>

      <GestureDetector gesture={gesture}>
        <View
          style={styles.video}
          accessibilityRole="button"
          accessibilityLabel={t('player.videoSurfaceA11y')}
          accessibilityHint={t('player.surfaceHint')}
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
