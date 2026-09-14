/**
 * Stage 2 player screen — composition / chrome only.
 * Session, resolver, and engine stay in `@/player`.
 */

import { memo, useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ErrorState } from '@/components/common/ErrorState';
import { Loader } from '@/components/common/Loader';
import { useTheme } from '@/hooks/use-theme';
import { localizePlayerError, useTranslation } from '@/localization';
import {
  formatPlaybackRateLabel,
  isRecoverablePlayerError,
  parseRouteMediaId,
  SEEK_FEEDBACK_MS,
  SEEK_STEP_SECONDS,
  shouldShowStartupCover,
  type DoubleTapSeekSide,
  type PlaybackRate,
} from '@/player';
import { useControlsVisibility } from '@/player/use-controls-visibility';
import { useFullscreenLifecycle } from '@/player/use-fullscreen-lifecycle';
import { usePlayerBrightness } from '@/player/hooks/use-player-brightness';
import { usePlayerOrientation } from '@/player/hooks/use-player-orientation';
import type { OrientationMode } from '@/player/orientation-mode';
import { usePlayerVolume } from '@/player/hooks/use-player-volume';
import { usePlayerSideGestures } from '@/player/use-player-side-gestures';
import { resolveOrientationIcon } from '@/player/volume-icons';
import { usePlayerSession } from '@/player/use-player-session';
import { useResumePrompt } from '@/playback/use-resume-prompt';
import { Button } from '@/components/buttons/Button';
import { getPlayerSupportContext } from '@/support';
import { openSupportWithContext } from '@/support/support-navigation';

import { PlayerControls } from './components/PlayerControls';
import { PlayerAdjustmentHud } from './components/PlayerAdjustmentHud';
import { PlaybackSpeedSheet } from './components/PlaybackSpeedSheet';
import { OrientationSheet } from './components/OrientationSheet';
import { PlayerTimeline } from './components/PlayerTimeline';
import { PlayerTopBar } from './components/PlayerTopBar';
import { PlayerVideoSurface } from './components/PlayerVideoSurface';
import {
  DoubleTapSeekFeedback,
  SeekFeedbackOverlay,
} from './components/SeekFeedback';

export const PlayerScreen = memo(function PlayerScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const mediaId = parseRouteMediaId(params.id);

  const {
    session,
    controller,
    player,
    resolveGeneration,
    markFirstFrameRendered,
    seekPreviewSeconds,
    beginSeekPreview,
    updateSeekPreview,
    commitSeekPreview,
    cancelSeekPreview,
    setPlaybackRate,
    setVolume,
    toggleMute,
    replay,
    retry,
  } = usePlayerSession(mediaId);

  // Auto-resume seek runs inside the hook (no Resume/Start Over sheet).
  // Cover stays until first frame, so resume seek happens behind the cover.
  useResumePrompt({
    mediaId,
    isReady: session.isReady,
    resolveGeneration,
    controller,
    activeMediaId: session.mediaId ?? mediaId,
  });

  const {
    isFullscreen,
    exitFullscreen,
    toggleFullscreen,
    restorePresentation,
    handleAndroidBack,
  } = useFullscreenLifecycle();

  const [speedSheetOpen, setSpeedSheetOpen] = useState(false);
  const [orientationSheetOpen, setOrientationSheetOpen] = useState(false);
  const [doubleTapSide, setDoubleTapSide] = useState<DoubleTapSeekSide | null>(
    null,
  );

  const [surfaceHeight, setSurfaceHeight] = useState(480);

  const brightness = usePlayerBrightness();
  const volume = usePlayerVolume();
  const { mode: orientationMode, setMode: setOrientationMode } = usePlayerOrientation();

  const isMuted = volume.available ? volume.isMuted : session.isMuted;
  const volumeLevel = volume.available ? volume.level : session.volume;

  useEffect(() => {
    if (!volume.available) {
      return;
    }
    setVolume(1);
  }, [setVolume, volume.available]);

  const getVolume = useCallback(() => session.volume, [session.volume]);

  const sideGestures = usePlayerSideGestures({
    surfaceHeight,
    brightness,
    volume,
    volumeFallback: volume.available
      ? undefined
      : {
          getLevel: getVolume,
          setLevel: (level) => {
            setVolume(level);
          },
        },
  });

  const startupCoverVisible = shouldShowStartupCover({
    isSurfaceRevealed: session.isSurfaceRevealed,
    hasError: Boolean(session.error),
  });

  const {
    controlsVisible,
    toggleControls,
    bumpControls,
    showControls,
  } = useControlsVisibility({
    isPlaying: session.isPlaying,
    isSeeking: session.isSeeking,
    isSpeedSheetOpen: speedSheetOpen,
    isOrientationSheetOpen: orientationSheetOpen,
    isLoading: session.isLoading || startupCoverVisible,
    hasError: Boolean(session.error),
    isCompleted: session.isCompleted,
  });

  useEffect(() => {
    if (session.error && isFullscreen) {
      void restorePresentation();
    }
  }, [session.error, isFullscreen, restorePresentation]);

  const leavePlayer = useCallback(async () => {
    try {
      controller.pause();
    } catch {
      // ignore
    }
    // Pause emits coordinator flush; unmount also emits playerExited.
    // Capture latest position before navigation tears down the surface.
    await restorePresentation();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/library');
    }
  }, [controller, restorePresentation, router]);

  const onChromeBack = useCallback(() => {
    if (speedSheetOpen) {
      setSpeedSheetOpen(false);
      return;
    }
    if (orientationSheetOpen) {
      setOrientationSheetOpen(false);
      return;
    }
    if (isFullscreen) {
      void exitFullscreen();
      return;
    }
    void leavePlayer();
  }, [exitFullscreen, isFullscreen, leavePlayer, orientationSheetOpen, speedSheetOpen]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (speedSheetOpen) {
        setSpeedSheetOpen(false);
        return true;
      }
      if (orientationSheetOpen) {
        setOrientationSheetOpen(false);
        return true;
      }
      const action = handleAndroidBack();
      if (action === 'exit_fullscreen') {
        return true;
      }
      void leavePlayer();
      return true;
    });
    return () => sub.remove();
  }, [handleAndroidBack, leavePlayer, orientationSheetOpen, speedSheetOpen]);

  const onPlayPause = useCallback(() => {
    bumpControls();
    if (!session.isReady || session.error) {
      return;
    }
    if (session.isPlaying) {
      controller.pause();
    } else {
      controller.play();
    }
  }, [
    bumpControls,
    controller,
    session.error,
    session.isPlaying,
    session.isReady,
  ]);

  const onRewind = useCallback(() => {
    bumpControls();
    if (!session.isReady) {
      return;
    }
    controller.seekBy(-SEEK_STEP_SECONDS);
  }, [bumpControls, controller, session.isReady]);

  const onForward = useCallback(() => {
    bumpControls();
    if (!session.isReady) {
      return;
    }
    controller.seekBy(SEEK_STEP_SECONDS);
  }, [bumpControls, controller, session.isReady]);

  const onReplay = useCallback(() => {
    bumpControls();
    replay();
  }, [bumpControls, replay]);

  const onToggleMute = useCallback(() => {
    bumpControls();
    if (volume.available) {
      volume.toggleMute();
      return;
    }
    toggleMute();
  }, [bumpControls, toggleMute, volume]);

  const onOpenSpeed = useCallback(() => {
    showControls();
    setOrientationSheetOpen(false);
    setSpeedSheetOpen(true);
  }, [showControls]);

  const onCloseSpeed = useCallback(() => {
    setSpeedSheetOpen(false);
    bumpControls();
  }, [bumpControls]);

  const onOpenOrientation = useCallback(() => {
    showControls();
    setSpeedSheetOpen(false);
    setOrientationSheetOpen(true);
  }, [showControls]);

  const onCloseOrientation = useCallback(() => {
    setOrientationSheetOpen(false);
    bumpControls();
  }, [bumpControls]);

  const onSelectOrientation = useCallback(
    (mode: OrientationMode) => {
      setOrientationMode(mode);
      bumpControls();
    },
    [bumpControls, setOrientationMode],
  );

  const onSelectSpeed = useCallback(
    (rate: PlaybackRate) => {
      setPlaybackRate(rate);
      setSpeedSheetOpen(false);
      bumpControls();
    },
    [bumpControls, setPlaybackRate],
  );

  const onSingleTap = useCallback(() => {
    if (speedSheetOpen || orientationSheetOpen || session.isSeeking) {
      return;
    }
    toggleControls();
  }, [orientationSheetOpen, session.isSeeking, speedSheetOpen, toggleControls]);

  const onDoubleTapSeek = useCallback(
    (side: DoubleTapSeekSide, delta: number) => {
      if (!session.isReady || session.error) {
        return;
      }
      controller.seekBy(delta);
      setDoubleTapSide(side);
      bumpControls();
    },
    [bumpControls, controller, session.error, session.isReady],
  );

  useEffect(() => {
    if (!doubleTapSide) {
      return;
    }
    const timer = setTimeout(() => setDoubleTapSide(null), SEEK_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [doubleTapSide]);

  const onSeekStart = useCallback(
    (seconds: number) => {
      beginSeekPreview(seconds);
      showControls();
    },
    [beginSeekPreview, showControls],
  );

  const onSeekCommit = useCallback(() => {
    commitSeekPreview();
    bumpControls();
  }, [bumpControls, commitSeekPreview]);

  const onSeekCancel = useCallback(() => {
    cancelSeekPreview();
    bumpControls();
  }, [bumpControls, cancelSeekPreview]);

  const title = session.displayName ?? t('player.untitled');
  const showError = session.phase === 'error' && session.error != null;
  const overlayVisible = controlsVisible || session.isSeeking || speedSheetOpen;
  const orientationIcon = resolveOrientationIcon(orientationMode);
  const playerSurfaceBg = theme.colors.black;
  const screenBg = showError ? theme.colors.background : playerSurfaceBg;

  const body = (
    <View
      style={[
        styles.body,
        isFullscreen ? styles.fullscreenBody : null,
        { backgroundColor: playerSurfaceBg },
      ]}>
      <View style={[styles.stage, { backgroundColor: playerSurfaceBg }]}>
        <PlayerVideoSurface
          player={player}
          gesturesEnabled={
            !speedSheetOpen && !orientationSheetOpen && !startupCoverVisible
          }
          brightnessGesturesEnabled={sideGestures.brightnessAvailable}
          onSingleTap={onSingleTap}
          onDoubleTapSeek={onDoubleTapSeek}
          onFirstFrameRender={markFirstFrameRendered}
          onSurfaceLayout={({ height }) => {
            if (height > 0) {
              setSurfaceHeight(height);
            }
          }}
          onBrightnessPanBegin={sideGestures.onBrightnessPanBegin}
          onBrightnessPanUpdate={sideGestures.onBrightnessPanUpdate}
          onBrightnessPanEnd={sideGestures.onBrightnessPanEnd}
          onVolumePanBegin={sideGestures.onVolumePanBegin}
          onVolumePanUpdate={sideGestures.onVolumePanUpdate}
          onVolumePanEnd={sideGestures.onVolumePanEnd}
        />
        {/*
          Instant opaque cover (no FadeOut). FadeOut over a SurfaceView that
          just flipped alpha caused the remaining startup shimmer.
          Cover drops only after composition-synced reveal.
        */}
        {startupCoverVisible ? (
          <View
            style={[
              styles.startupCover,
              { backgroundColor: playerSurfaceBg },
            ]}
            pointerEvents="auto"
            accessibilityLabel={t('player.preparing')}>
            <Loader size="large" accessibilityLabel={t('player.preparing')} />
            <Text variant="bodySmall" color="textSecondary">
              {t('player.preparing')}
            </Text>
          </View>
        ) : null}
        <PlayerAdjustmentHud
          type={sideGestures.hud.kind}
          percent={sideGestures.hud.percent}
          visible={sideGestures.hud.visible}
        />
        {/* Single TopBar instance — avoids cover→controls remount swap shimmer. */}
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {(startupCoverVisible || overlayVisible) && !showError ? (
            <PlayerTopBar
              title={title}
              isFullscreen={isFullscreen}
              visible
              orientationIcon={orientationIcon}
              onBack={onChromeBack}
              onOpenOrientation={onOpenOrientation}
              onToggleFullscreen={() => {
                bumpControls();
                void toggleFullscreen();
              }}
            />
          ) : null}
          {overlayVisible && !startupCoverVisible ? (
            <PlayerControls
              isPlaying={session.isPlaying}
              isReady={session.isReady}
              isLoading={session.isLoading && session.hasFirstFrame}
              isCompleted={session.isCompleted}
              isMuted={isMuted}
              volumeLevel={volumeLevel}
              playbackRate={session.playbackRate}
              disabled={Boolean(session.error)}
              visible
              onPlayPause={onPlayPause}
              onRewind={onRewind}
              onForward={onForward}
              onReplay={onReplay}
              onToggleMute={onToggleMute}
              onOpenSpeed={onOpenSpeed}
            />
          ) : null}
        </View>
        <SeekFeedbackOverlay
          previewSeconds={seekPreviewSeconds}
          durationSeconds={session.durationSeconds}
          visible={session.isSeeking}
        />
        <DoubleTapSeekFeedback side={doubleTapSide} />
      </View>

      {(overlayVisible || session.isSeeking) && !startupCoverVisible ? (
        <Box
          px={16}
          pb={isFullscreen ? 12 : 16}
          pt={8}
          gap={4}
          style={styles.timelineDock}>
          <PlayerTimeline
            positionSeconds={session.positionSeconds}
            durationSeconds={session.durationSeconds}
            previewSeconds={seekPreviewSeconds}
            disabled={!session.isReady || Boolean(session.error)}
            onSeekStart={onSeekStart}
            onSeekChange={updateSeekPreview}
            onSeekCommit={onSeekCommit}
            onSeekCancel={onSeekCancel}
          />
          {session.isSeeking ? null : (
            <Text variant="caption" color="textSecondary">
              Speed {formatPlaybackRateLabel(session.playbackRate)}
              {isMuted ? ' · Muted' : ''}
            </Text>
          )}
        </Box>
      ) : null}
    </View>
  );

  return (
    <SafeAreaScreen
      padded={false}
      edges={isFullscreen ? [] : ['left', 'right', 'top', 'bottom']}
      style={{ backgroundColor: screenBg }}
      safeAreaStyle={{ backgroundColor: screenBg }}>
      {showError ? (
        <Box flex={1} center p={24} gap={16}>
          <ErrorState
            title={
              session.error
                ? localizePlayerError(session.error).title
                : t('player.errors.PLAYBACK_FAILED.title')
            }
            message={
              session.error
                ? localizePlayerError(session.error).message
                : t('player.errors.PLAYBACK_FAILED.message')
            }
            retryLabel={
              session.error && isRecoverablePlayerError(session.error)
                ? t('common.retry')
                : undefined
            }
            onRetry={
              session.error && isRecoverablePlayerError(session.error)
                ? () => {
                    retry();
                  }
                : undefined
            }
          />
          <Button
            title={t('common.goBack')}
            variant="outline"
            onPress={() => {
              void leavePlayer();
            }}
            accessibilityLabel={t('player.goBack')}
          />
          <Button
            title={t('support.getHelp')}
            variant="outline"
            onPress={() => {
              openSupportWithContext(getPlayerSupportContext(session.error));
            }}
            accessibilityLabel={t('support.getHelpA11y')}
            accessibilityHint={t('support.getHelpHint')}
          />
        </Box>
      ) : (
        body
      )}

      <PlaybackSpeedSheet
        visible={speedSheetOpen}
        selectedRate={session.playbackRate}
        onSelect={onSelectSpeed}
        onClose={onCloseSpeed}
      />
      <OrientationSheet
        visible={orientationSheetOpen}
        selectedMode={orientationMode}
        onSelect={onSelectOrientation}
        onClose={onCloseOrientation}
      />
    </SafeAreaScreen>
  );
});

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  fullscreenBody: {
    ...StyleSheet.absoluteFill,
  },
  stage: {
    flex: 1,
    position: 'relative',
  },
  startupCover: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    zIndex: 2,
  },
  timelineDock: {
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
});
