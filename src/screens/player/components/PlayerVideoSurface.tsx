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
  DEFAULT_SEEK_STEP_SECONDS,
  doubleTapSeekDelta,
  resolveDoubleTapAction,
  SIDE_ZONE_RATIO,
  type DoubleTapAction,
  type DoubleTapSeekSide,
} from '@/player';
import {
  DEFAULT_VIDEO_FIT,
  mirrorScale,
  videoFitLayout,
  type Insets,
  type MirrorMode,
  type VideoFit,
} from '@/player/video-display';
import {
  anchoredTranslation,
  clampTranslation,
  isZoomed,
  maxTranslation,
  rubberBandScale,
  rubberBandTranslation,
  settleScale,
  settleTranslation,
  type Size,
} from '@/player/zoom-math';

const SETTLE = { duration: 180 };
const LONG_PRESS_MS = 500;

export type PlayerVideoSurfaceProps = {
  player: VideoPlayer;
  gesturesEnabled?: boolean;
  brightnessGesturesEnabled?: boolean;
  onSingleTap?: () => void;
  onDoubleTapSeek?: (side: DoubleTapSeekSide, deltaSeconds: number) => void;
  /** Double tap in the middle third. */
  onDoubleTapTogglePlay?: () => void;
  /** How far a double tap on either side jumps (P1 #527); 10 s when not given. */
  seekStepSeconds?: number;
  /** P1 #545: a finger held still on the picture (fast forward while held). */
  onLongPressStart?: () => void;
  /** Runs for every hold that began, however it ended (finger lifted, cancelled, another gesture won). */
  onLongPressEnd?: () => void;
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
  /** P2 #564–#566: fit, crop to fill, stretch, or a forced ratio. Default: fit (the whole picture, its own shape). */
  fit?: VideoFit;
  /** P2 #573: the picture mirrored left ↔ right, flipped upside down, or both. */
  mirror?: MirrorMode;
  /** P2 #576: insets the picture keeps clear of (the camera cutout in full screen); null to use the whole surface. */
  pictureInsets?: Insets | null;
  /** Arms the automatic picture-in-picture window for when the user leaves VidoraX. */
  pictureInPictureAutoEnter?: boolean;
  onPictureInPictureStart?: () => void;
  onPictureInPictureStop?: () => void;
  onSurfaceLayout?: (size: { width: number; height: number }) => void;
  /** Native first painted frame — prefer over readyToPlay for cover dismissal. */
  onFirstFrameRender?: () => void;
  /** False while VidoraX is stopped with background play on: the view lets go of the player (sound only). */
  surfaceAttached?: boolean;
};

export const PlayerVideoSurface = memo(function PlayerVideoSurface({
  player,
  gesturesEnabled = true,
  brightnessGesturesEnabled = true,
  onSingleTap,
  onDoubleTapSeek,
  onDoubleTapTogglePlay,
  seekStepSeconds,
  onLongPressStart,
  onLongPressEnd,
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
  fit = DEFAULT_VIDEO_FIT,
  mirror = 'none',
  pictureInsets = null,
  pictureInPictureAutoEnter = false,
  onPictureInPictureStart,
  onPictureInPictureStop,
  onSurfaceLayout,
  onFirstFrameRender,
  surfaceAttached = true,
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

  // Geometry the gestures clamp against: the surface, and the picture as the fit draws it (P2: crop draws it bigger
  // than the surface, stretch and a forced ratio fill their frame, the cutout insets shrink the frame).
  const picture = contentSize ?? trackSize;
  const fitLayout = useMemo(
    () => videoFitLayout(layout, picture, fit, pictureInsets),
    [fit, layout, picture, pictureInsets],
  );
  const fittedWidth = fitLayout.content.width;
  const fittedHeight = fitLayout.content.height;
  useEffect(() => {
    const fitted = { width: fittedWidth, height: fittedHeight };
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
    fittedHeight,
    fittedWidth,
    layout,
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
    (action: DoubleTapAction) => {
      if (action === 'togglePlay') {
        onDoubleTapTogglePlay?.();
        return;
      }
      if (action === 'seekBack' || action === 'seekForward') {
        const side: DoubleTapSeekSide = action === 'seekBack' ? 'left' : 'right';
        onDoubleTapSeek?.(side, doubleTapSeekDelta(side, seekStepSeconds));
      }
    },
    [onDoubleTapSeek, onDoubleTapTogglePlay, seekStepSeconds],
  );

  const longPressStart = useCallback(() => {
    onLongPressStart?.();
  }, [onLongPressStart]);
  const longPressEnd = useCallback(() => {
    onLongPressEnd?.();
  }, [onLongPressEnd]);

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

    // Double tap: back to fitted while zoomed (and nothing else); otherwise by third — −10 s / play-pause / +10 s.
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(280)
      .enabled(gesturesEnabled)
      .onEnd((event, success) => {
        if (!success) {
          return;
        }
        const action = resolveDoubleTapAction(event.x, surfaceWidth.value, isZoomed(scale.value));
        if (action === 'resetZoom') {
          scale.value = withTiming(1, SETTLE);
          translateX.value = withTiming(0, SETTLE);
          translateY.value = withTiming(0, SETTLE);
          lastZoomPercent.value = 100;
          runOnJS(setZoomed)(false);
          return;
        }
        if (action) {
          runOnJS(handleDoubleTap)(action);
        }
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

    // P1 #545: a finger held still for half a second plays fast until it lifts. Taps fail long before it starts, and
    // moving first starts a swipe instead; once it has started it owns the touch. `onFinalize` runs for every touch
    // it saw, so the end is reported even when the hold was cancelled.
    const longPress = Gesture.LongPress()
      .minDuration(LONG_PRESS_MS)
      .maxDistance(12)
      .enabled(gesturesEnabled && Boolean(onLongPressStart))
      .onStart(() => {
        runOnJS(longPressStart)();
      })
      .onFinalize(() => {
        runOnJS(longPressEnd)();
      });

    return Gesture.Race(
      Gesture.Simultaneous(pinch, zoomPan),
      brightnessPan,
      volumePan,
      longPress,
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
    longPressEnd,
    longPressStart,
    onLongPressStart,
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

  // The picture's frame inside the zoomed layer: the whole surface (as before P2) unless a forced ratio or the cutout
  // insets make it smaller. It clips (a cropped picture never spills past it, e.g. into the cutout strip). Mirror / flip
  // is applied here, inside the zoom, so pinching and panning still follow the fingers on screen.
  const { scaleX, scaleY } = mirrorScale(mirror);
  const frameStyle = useMemo(
    () => [
      fitLayout.fullSurface || layout.width <= 0
        ? styles.frame
        : {
            position: 'absolute' as const,
            overflow: 'hidden' as const,
            left: fitLayout.frame.x,
            top: fitLayout.frame.y,
            width: fitLayout.frame.width,
            height: fitLayout.frame.height,
          },
      scaleX === 1 && scaleY === 1 ? null : { transform: [{ scaleX }, { scaleY }] },
    ],
    [fitLayout.frame, fitLayout.fullSurface, layout.width, scaleX, scaleY],
  );

  return (
    <View
      style={[styles.surface, { backgroundColor: theme.colors.black }]}
      onLayout={onLayout}>
      <Animated.View style={[styles.video, zoomStyle]} pointerEvents="none">
        {/* Never flattened away: mirroring or a new frame must not re-parent (and so restart) the video view. */}
        <View style={frameStyle} collapsable={false} pointerEvents="none" testID="player-video-frame">
          {surfaceAttached ? (
          <VideoView
            player={player}
            style={styles.video}
            contentFit={fitLayout.contentFit}
            nativeControls={false}
            fullscreenOptions={{ enable: false }}
            // Drawn in the view hierarchy, so zoom and mirror transforms and the surface's clipping apply exactly.
            surfaceType="textureView"
            allowsPictureInPicture
            startsPictureInPictureAutomatically={pictureInPictureAutoEnter}
            onPictureInPictureStart={onPictureInPictureStart}
            onPictureInPictureStop={onPictureInPictureStop}
            pointerEvents="none"
            onFirstFrameRender={onFirstFrameRender}
          />
          ) : null}
        </View>
      </Animated.View>

      <GestureDetector gesture={gesture}>
        <View
          style={styles.video}
          accessibilityRole="button"
          accessibilityLabel={t('player.videoSurfaceA11y')}
          accessibilityHint={t('videoPlayer.surfaceHint', { seconds: seekStepSeconds ?? DEFAULT_SEEK_STEP_SECONDS })}
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
  frame: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
});
