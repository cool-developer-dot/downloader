/**
 * Stage 2 player screen — composition / chrome only.
 * Session, resolver, and engine stay in `@/player`; the session itself runs in the app-wide PlayerSessionHost, so
 * leaving this screen keeps the same player (and position) going in the in-app mini player.
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { router as appRouter, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ErrorState } from '@/components/common/ErrorState';
import { Loader } from '@/components/common/Loader';
import { useTheme } from '@/hooks/use-theme';
import { localizePlayerError, useTranslation, type TranslationKey } from '@/localization';
import { completedActionErrorMessageKey } from '@/downloads/completed-file/action-errors';
import {
  formatPlaybackRateLabel,
  isRecoverablePlayerError,
  parseRouteMediaId,
  SEEK_FEEDBACK_MS,
  SEEK_STEP_SECONDS,
  shouldArmPictureInPicture,
  shouldShowStartupCover,
  type DoubleTapSeekSide,
  type PlaybackRate,
} from '@/player';
import { useControlsVisibility } from '@/player/use-controls-visibility';
import { useFullscreenLifecycle } from '@/player/use-fullscreen-lifecycle';
import { usePlayQueueNeighbours } from '@/player/play-queue';
import { usePlayerBrightness } from '@/player/hooks/use-player-brightness';
import { usePlayerOrientation } from '@/player/hooks/use-player-orientation';
import type { OrientationMode } from '@/player/orientation-mode';
import { usePlayerVolume } from '@/player/hooks/use-player-volume';
import { usePlayerSideGestures } from '@/player/use-player-side-gestures';
import { armNativePictureInPicture, pictureInPictureSupported } from '@/player/picture-in-picture';
import { parseResolution } from '@/player/zoom-math';
import { useDownloadsStore } from '@/store/downloads';
import { resolveOrientationIcon, resolveVolumeIcon } from '@/player/volume-icons';
import {
  closePlayerSession,
  openPlayerSession,
  setPlayerSessionPictureInPicture,
  useFullPlayerSession,
  useRedrawOnAttach,
  type LivePlayerSession,
} from '@/player/session-host';
import { Button } from '@/components/buttons/Button';
import { IconButton } from '@/components/buttons/IconButton';
import { Pressable } from '@/components/base/Pressable';
import { getPlayerSupportContext } from '@/support';
import { openSupportWithContext } from '@/support/support-navigation';

import { PlayerControls } from './components/PlayerControls';
import { PlayerLockButton, PlayerLockedOverlay } from './components/PlayerLockControl';
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
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const mediaId = parseRouteMediaId(params.id);
  const live = useFullPlayerSession(mediaId);
  // Owned here, not by the session view: Previous / Next swap the session (the view remounts) and must keep the
  // Player fullscreen and locked as it was.
  const fullscreen = useFullscreenLifecycle();
  const [locked, setLocked] = useState(false);

  // Back on top (another Player above it closed): this route's media is the session again.
  useFocusEffect(
    useCallback(() => {
      openPlayerSession(mediaId);
    }, [mediaId]),
  );

  if (!live) {
    return <PlayerOpeningShell isFullscreen={fullscreen.isFullscreen} />;
  }
  return (
    <PlayerSessionView
      key={live.key}
      live={live}
      mediaId={mediaId}
      fullscreen={fullscreen}
      locked={locked}
      setLocked={setLocked}
    />
  );
});

/** The first frames of a newly opened session: the same black stage and spinner as the startup cover. */
function PlayerOpeningShell({ isFullscreen }: { isFullscreen: boolean }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <SafeAreaScreen
      padded={false}
      edges={isFullscreen ? [] : ['left', 'right', 'top', 'bottom']}
      style={{ backgroundColor: theme.colors.black }}
      safeAreaStyle={{ backgroundColor: theme.colors.black }}>
      <View style={styles.openingShell} accessibilityLabel={t('player.preparing')}>
        <Loader size="large" accessibilityLabel={t('player.preparing')} />
        <Text variant="bodySmall" color="textSecondary">
          {t('player.preparing')}
        </Text>
      </View>
    </SafeAreaScreen>
  );
}

const PlayerSessionView = memo(function PlayerSessionView({
  live,
  mediaId,
  fullscreen,
  locked,
  setLocked,
}: {
  live: LivePlayerSession;
  mediaId: string | null;
  fullscreen: ReturnType<typeof useFullscreenLifecycle>;
  locked: boolean;
  setLocked: (locked: boolean) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();

  const {
    key: sessionKey,
    session,
    controller,
    player,
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
    setPictureInPictureArmed,
    onPictureInPictureStart,
    onPictureInPictureStop,
  } = live;
  const activeMediaId = session.mediaId ?? mediaId;
  // Resume seek and autoplay run with the session (PlayerSessionHost), not here: reopening the Player from the mini
  // player continues where it is — and shows the paused frame there, which a new surface lacks.
  const [reopened] = useState(() => session.isSurfaceRevealed);
  useRedrawOnAttach(player, reopened);

  const {
    isFullscreen,
    exitFullscreen,
    toggleFullscreen,
    restorePresentation,
    handleAndroidBack,
  } = fullscreen;

  const [speedSheetOpen, setSpeedSheetOpen] = useState(false);
  const [externalOpenError, setExternalOpenError] = useState<string | null>(null);
  const [externalOpenBusy, setExternalOpenBusy] = useState(false);
  const openExternal = useCallback(async () => {
    if (!mediaId || externalOpenBusy) return;
    setExternalOpenBusy(true);
    setExternalOpenError(null);
    try {
      const { openCompletedFile } = await import('@/downloads/completed-file/action-service');
      const result = await openCompletedFile(mediaId);
      if (!result.ok) setExternalOpenError(t(completedActionErrorMessageKey(result.error.code) as TranslationKey));
    } catch {
      setExternalOpenError(t('files.openFailed'));
    } finally {
      setExternalOpenBusy(false);
    }
  }, [externalOpenBusy, mediaId, t]);
  const [orientationSheetOpen, setOrientationSheetOpen] = useState(false);
  const [doubleTapSide, setDoubleTapSide] = useState<DoubleTapSeekSide | null>(
    null,
  );

  const [surfaceHeight, setSurfaceHeight] = useState(480);

  // The picture as displayed (rotation applied) from the library; the player's own track size is the fallback.
  const libraryResolution = useDownloadsStore((state) =>
    activeMediaId ? (state.engineRowsById[activeMediaId]?.resolution ?? null) : null,
  );
  const contentSize = useMemo(() => parseResolution(libraryResolution), [libraryResolution]);

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

  // Picture-in-picture: leaving VidoraX while the video plays moves this same player into a floating window.
  // While the window shows, the arming must not change — the player view elected for the window has to stay the one
  // put back when it closes.
  const pipSupported = useMemo(() => pictureInPictureSupported(), []);
  const [pipActive, setPipActive] = useState(false);
  const pipArmedNow = shouldArmPictureInPicture({
    supported: pipSupported,
    isPlaying: session.isPlaying,
    isReady: session.isReady,
    hasError: Boolean(session.error),
    isSurfaceRevealed: session.isSurfaceRevealed,
  });
  const pipAutoEnter = pipActive || pipArmedNow;
  useEffect(() => {
    setPictureInPictureArmed(pipAutoEnter);
    armNativePictureInPicture(pipAutoEnter, contentSize);
  }, [contentSize, pipAutoEnter, setPictureInPictureArmed]);
  // Only the full Player opens a PiP window: once it is gone (the session may go on in the mini player), leaving the
  // app pauses instead.
  useEffect(
    () => () => {
      armNativePictureInPicture(false, null);
      setPictureInPictureArmed(false);
      setPlayerSessionPictureInPicture(false);
    },
    [setPictureInPictureArmed],
  );

  const hud = sideGestures.hud;
  const handlePictureInPictureStart = useCallback(() => {
    hud.hideNow();
    setPipActive(true);
    setPlayerSessionPictureInPicture(true);
    onPictureInPictureStart();
  }, [hud, onPictureInPictureStart]);
  const handlePictureInPictureStop = useCallback(() => {
    setPipActive(false);
    setPlayerSessionPictureInPicture(false);
    onPictureInPictureStop();
  }, [onPictureInPictureStop]);

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

  // Leaving collapses the Player into the mini player: the session keeps playing (same player, same position). A failed
  // session has nothing to continue, so it ends here (closing it reports the exit position and releases the player).
  const sessionFailed = session.error != null;
  const leavePlayer = useCallback(async () => {
    if (sessionFailed) {
      closePlayerSession(sessionKey);
    }
    await restorePresentation();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/library');
    }
  }, [restorePresentation, router, sessionFailed, sessionKey]);

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
      if (locked) {
        // A locked screen ignores Back too (pocket / child presses); the lock pill unlocks.
        return true;
      }
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
  }, [handleAndroidBack, leavePlayer, locked, orientationSheetOpen, speedSheetOpen]);

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

  // Double tap in the middle third: same as the play/pause button (which also keeps the controls' timer fresh).
  const onDoubleTapTogglePlay = onPlayPause;

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

  // Previous / Next: the route param changes in place, so the Player stays mounted (and fullscreen) and the shared
  // session switches to that media.
  const { previousId, nextId } = usePlayQueueNeighbours(activeMediaId);
  const hasQueue = previousId != null || nextId != null;
  const goToMedia = useCallback(
    (id: string) => {
      bumpControls();
      appRouter.setParams({ id });
    },
    [bumpControls],
  );
  const onPrevious = useMemo(() => (previousId ? () => goToMedia(previousId) : null), [goToMedia, previousId]);
  const onNext = useMemo(() => (nextId ? () => goToMedia(nextId) : null), [goToMedia, nextId]);

  const onLock = useCallback(() => {
    hud.hideNow();
    setSpeedSheetOpen(false);
    setOrientationSheetOpen(false);
    setLocked(true);
  }, [hud, setLocked]);
  const onUnlock = useCallback(() => {
    setLocked(false);
    showControls();
  }, [setLocked, showControls]);

  const title = session.displayName ?? t('player.untitled');
  const showError = session.phase === 'error' && session.error != null;
  const overlayVisible = !locked && (controlsVisible || session.isSeeking || speedSheetOpen);
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
            !locked && !speedSheetOpen && !orientationSheetOpen && !startupCoverVisible
          }
          brightnessGesturesEnabled={sideGestures.brightnessAvailable}
          onSingleTap={onSingleTap}
          onDoubleTapSeek={onDoubleTapSeek}
          onDoubleTapTogglePlay={onDoubleTapTogglePlay}
          onFirstFrameRender={markFirstFrameRendered}
          onSurfaceLayout={({ height }) => {
            if (height > 0) {
              setSurfaceHeight(height);
            }
          }}
          onBrightnessPanStart={sideGestures.onBrightnessPanStart}
          onBrightnessPanUpdate={sideGestures.onBrightnessPanUpdate}
          onBrightnessPanFinalize={sideGestures.onBrightnessPanFinalize}
          onVolumePanStart={sideGestures.onVolumePanStart}
          onVolumePanUpdate={sideGestures.onVolumePanUpdate}
          onVolumePanFinalize={sideGestures.onVolumePanFinalize}
          onZoomChange={sideGestures.onZoomChange}
          onZoomFinalize={sideGestures.onZoomFinalize}
          zoomResetKey={activeMediaId ?? ''}
          contentSize={contentSize}
          pictureInPictureAutoEnter={pipAutoEnter}
          onPictureInPictureStart={handlePictureInPictureStart}
          onPictureInPictureStop={handlePictureInPictureStop}
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
        <PlayerAdjustmentHud hud={sideGestures.hud} />
        {/* Single TopBar instance — avoids cover→controls remount swap shimmer. */}
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {(startupCoverVisible || overlayVisible) && !showError && !locked ? (
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
              disabled={Boolean(session.error)}
              visible
              hasQueue={hasQueue}
              onPrevious={onPrevious}
              onNext={onNext}
              onPlayPause={onPlayPause}
              onRewind={onRewind}
              onForward={onForward}
              onReplay={onReplay}
            />
          ) : null}
          {overlayVisible && !startupCoverVisible && !showError ? (
            <PlayerLockButton onLock={onLock} />
          ) : null}
        </View>
        <SeekFeedbackOverlay
          previewSeconds={seekPreviewSeconds}
          durationSeconds={session.durationSeconds}
          visible={session.isSeeking}
        />
        <DoubleTapSeekFeedback side={doubleTapSide} />
        {locked && !showError ? <PlayerLockedOverlay onUnlock={onUnlock} /> : null}
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
            <Box row style={styles.dockActions}>
              <IconButton
                icon={resolveVolumeIcon(volumeLevel, isMuted)}
                size="small"
                variant="ghost"
                color={session.error ? 'disabled' : 'inverse'}
                accessibilityLabel={isMuted ? t('player.unmute') : t('player.mute')}
                disabled={Boolean(session.error)}
                onPress={onToggleMute}
              />
              <Pressable
                onPress={onOpenSpeed}
                disabled={Boolean(session.error)}
                accessibilityRole="button"
                accessibilityLabel={t('player.playbackSpeedSelected', {
                  rate: formatPlaybackRateLabel(session.playbackRate),
                })}
                hitSlop={8}
                style={styles.speedChip}>
                <Text variant="caption" color="white">
                  {formatPlaybackRateLabel(session.playbackRate)}
                </Text>
              </Pressable>
            </Box>
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
          {session.error === 'UNSUPPORTED_MEDIA' || session.error === 'PLAYBACK_FAILED' ? (
            <Button
              title={t('library.openWith')}
              onPress={() => { void openExternal(); }}
              disabled={externalOpenBusy}
              testID="player-open-externally"
            />
          ) : null}
          {externalOpenError ? <Text color="error">{externalOpenError}</Text> : null}
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
  openingShell: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
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
  dockActions: {
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  speedChip: {
    minWidth: 44,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.5)',
  },
});
