/**
 * Stage 2 player screen — composition / chrome only.
 * Session, resolver, and engine stay in `@/player`; the session itself runs in the app-wide PlayerSessionHost, so
 * leaving this screen keeps the same player (and position) going in the in-app mini player.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  Platform,
  StyleSheet,
  ToastAndroid,
  useWindowDimensions,
  View,
} from 'react-native';
import { router as appRouter, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  formatPlaybackTime,
  frameAt,
  frameStep,
  frameStepBase,
  isRecoverablePlayerError,
  LONG_PRESS_PLAYBACK_RATE,
  LongPressSpeed,
  parseRouteMediaId,
  SEEK_FEEDBACK_MS,
  shouldArmPictureInPicture,
  shouldShowStartupCover,
  type DoubleTapSeekSide,
  type PlaybackRate,
  type SeekStepSeconds,
} from '@/player';
import { setSeekStepSeconds, useSeekStepSeconds } from '@/player/seek-step-preference';
import type { MirrorMode, VideoFit } from '@/player/video-display';
import { mirrorModeLabel, videoFitLabel } from '@/player/video-display-labels';
import {
  setFillCutout,
  setInfoOverlay,
  setVideoFit,
  setVideoMirror,
  useVideoDisplay,
} from '@/player/video-display-preference';
import type { PlayerOptionContext, PlayerOptionUi } from '@/player/options';
import { useControlsVisibility } from '@/player/use-controls-visibility';
import { useFullscreenLifecycle } from '@/player/use-fullscreen-lifecycle';
import { usePlayQueueNeighbours } from '@/player/play-queue';
import { usePlayerBrightness } from '@/player/hooks/use-player-brightness';
import { usePlayerOrientation } from '@/player/hooks/use-player-orientation';
import type { OrientationMode } from '@/player/orientation-mode';
import { usePlayerVolume } from '@/player/hooks/use-player-volume';
import { usePlayerSideGestures } from '@/player/use-player-side-gestures';
import {
  armNativePictureInPicture,
  pictureInPictureSupported,
  subscribeActivityStopped,
} from '@/player/picture-in-picture';
import { externalMediaId, externalTokenOf, knownIncomingMedia } from '@/player/external-media';
import { isStreamMediaId } from '@/player/remote-stream';
import { useSeekPreview } from '@/player/use-seek-preview';
import {
  openIncomingWithOtherApp,
  saveIncomingMedia,
  type SaveIncomingOutcome,
} from '@/player/incoming-media.runtime';
import { parseResolution } from '@/player/zoom-math';
import { useDownloadsStore } from '@/store/downloads';
import { resolveOrientationIcon, resolveVolumeIcon } from '@/player/volume-icons';
import {
  closePlayerSession,
  openPlayerSession,
  setPlayerSessionPictureInPicture,
  useFullPlayerSession,
  useRedrawOnAttach,
  useVideoSurfaceAttachment,
  type LivePlayerSession,
} from '@/player/session-host';
import { Button } from '@/components/buttons/Button';
import { IconButton } from '@/components/buttons/IconButton';
import { Pressable } from '@/components/base/Pressable';
import { getPlayerSupportContext } from '@/support';
import { openSupportWithContext } from '@/support/support-navigation';
import { DsHeader, ds } from '@/design';
import { DS_TAB_ROUTES, DsTabBarView } from '@/navigation/components/DsTabBar';
import { routePaths, tabRouteNames } from '@/navigation/constants';

import { PlayerControls } from './components/PlayerControls';
import { PlayerLockButton, PlayerLockedOverlay } from './components/PlayerLockControl';
import { PlayerAdjustmentHud } from './components/PlayerAdjustmentHud';
import { PlaybackSpeedSheet } from './components/PlaybackSpeedSheet';
import { OrientationSheet } from './components/OrientationSheet';
import { PlayerTimeline } from './components/PlayerTimeline';
import { PlayerTopBar } from './components/PlayerTopBar';
import { useMediaArtist } from '@/media-edit/media-tags-store';
import { PlayerVideoSurface } from './components/PlayerVideoSurface';
import {
  DoubleTapSeekFeedback,
  SeekFeedbackOverlay,
} from './components/SeekFeedback';
import { playerCardSize } from './page/card-size';
import { FrameStepPanel } from './page/FrameStepPanel';
import { JumpToTimeSheet } from './page/JumpToTimeSheet';
import { LongPressSpeedPill } from './page/LongPressSpeedPill';
import { PlayerCardOverlay } from './page/PlayerCardOverlay';
import { PlayerOptionsSheet } from './page/PlayerOptionsSheet';
import { PlayerPageBody } from './page/PlayerPageBody';
import { NOT_YET_ACTIONS, type PlayerPageAction } from './page/player-page-actions';
import { SeekIntervalSheet } from './page/SeekIntervalSheet';
import { announcePlayer, usePlayerNotYet } from './page/use-player-not-yet';
import { qualityLabel, useVideoTrackInfo } from './page/use-video-track-info';
import { AspectRatioSheet, MirrorFlipSheet } from './page/VideoDisplaySheets';
import { VideoInfoLine, VideoInfoOverlay } from './page/VideoInfoOverlay';

/** The bar's tabs as paths: pressing one on the Player page leaves the Player (into the mini player) for that tab. */
const TAB_PATHS: Readonly<Record<string, string>> = {
  [tabRouteNames.browser]: routePaths.browser,
  [tabRouteNames.downloads]: routePaths.downloads,
  [tabRouteNames.library]: routePaths.library,
  [tabRouteNames.files]: routePaths.files,
  [tabRouteNames.settings]: routePaths.settings,
};

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
  // F14: a frame above the scrubber while dragging (files on the device that show video; not streams or audio).
  const seekPreview = useSeekPreview(player, {
    mediaId: activeMediaId,
    hasVideoFrame: session.hasFirstFrame,
    scrubSeconds: session.isSeeking ? seekPreviewSeconds : null,
  });
  // Resume seek and autoplay run with the session (PlayerSessionHost), not here: reopening the Player from the mini
  // player continues where it is — and shows the paused frame there, which a new surface lacks.
  const [reopened] = useState(() => session.isSurfaceRevealed);
  useRedrawOnAttach(player, reopened);
  // Background play lets the surface go while VidoraX is stopped; a paused frame is drawn again on return.
  const surface = useVideoSurfaceAttachment();
  useRedrawOnAttach(player, surface.generation > 0, surface.generation);

  const {
    isFullscreen,
    exitFullscreen,
    toggleFullscreen,
    restorePresentation,
    handleAndroidBack,
  } = fullscreen;

  const [speedSheetOpen, setSpeedSheetOpen] = useState(false);
  // P1: the ⋮ Video options menu, the seek interval and jump-to-time sheets, and the (non-modal) frame panel.
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [seekIntervalOpen, setSeekIntervalOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  // P2: the Aspect ratio (#564–#566) or the Mirror / Flip (#573) sheet.
  const [displaySheet, setDisplaySheet] = useState<'aspectRatio' | 'mirrorFlip' | null>(null);
  const [frameMode, setFrameMode] = useState(false);
  const [frameShown, setFrameShown] = useState<{ frameIndex: number; frameStartSeconds: number } | null>(null);
  const lastFrameStepRef = useRef<{ target: number; at: number } | null>(null);
  const seekStepSeconds = useSeekStepSeconds();
  const trackInfo = useVideoTrackInfo(player);
  // P2: fit (per video), mirror (this video), notch area and info overlay.
  const display = useVideoDisplay(activeMediaId);
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const notYet = usePlayerNotYet();
  const [externalOpenError, setExternalOpenError] = useState<string | null>(null);
  const [externalOpenBusy, setExternalOpenBusy] = useState(false);
  // A file another app opened with VidoraX: no library row; it can be saved into the library.
  const incomingToken = externalTokenOf(activeMediaId);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const onSaveToLibrary = useCallback(async () => {
    if (!incomingToken || saveState !== 'idle') return;
    setSaveState('saving');
    const outcome = await saveIncomingMedia(incomingToken);
    const saved = outcome.kind === 'saved' || outcome.kind === 'duplicate';
    setSaveState(saved ? 'saved' : 'idle');
    const message = t(SAVE_OUTCOME_MESSAGE[outcome.kind]);
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    }
    AccessibilityInfo.announceForAccessibility(message);
  }, [incomingToken, saveState, t]);

  const openExternal = useCallback(async () => {
    if (!mediaId || externalOpenBusy) return;
    setExternalOpenBusy(true);
    setExternalOpenError(null);
    if (incomingToken) {
      // P8 #461: a file whose bytes do not match its name is warned about before another app opens it.
      const { confirmIncomingFileAction } = await import('@/downloads/safety/file-safety-dialog');
      if (!(await confirmIncomingFileAction(incomingToken, 'open', knownIncomingMedia(externalMediaId(incomingToken))?.displayName ?? null))) {
        setExternalOpenBusy(false);
        return;
      }
      const code = await openIncomingWithOtherApp(incomingToken);
      if (code) {
        setExternalOpenError(t(code === 'ERR_NO_APP' ? 'files.noCompatibleApp' : 'errors.openFailed'));
      }
      setExternalOpenBusy(false);
      return;
    }
    try {
      const { openCompletedFile } = await import('@/downloads/completed-file/action-service');
      const result = await openCompletedFile(mediaId);
      if (!result.ok) setExternalOpenError(t(completedActionErrorMessageKey(result.error.code) as TranslationKey));
    } catch {
      setExternalOpenError(t('files.openFailed'));
    } finally {
      setExternalOpenBusy(false);
    }
  }, [externalOpenBusy, incomingToken, mediaId, t]);
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

  // A stopped activity shows no PiP window, also when expo-video's stop event never came (see use-player-session).
  useEffect(
    () =>
      subscribeActivityStopped(() => {
        setPipActive(false);
        setPlayerSessionPictureInPicture(false);
      }),
    [],
  );

  const hud = sideGestures.hud;

  // P1 #545: 2× while a finger holds the picture. The rate goes to the player only; every way the hold can end
  // (finger up, lock, a sheet, PiP, frame panel, Stop, this view going away) restores the chosen speed.
  const controllerRef = useRef(controller);
  const chosenRateRef = useRef(session.playbackRate);
  useEffect(() => {
    controllerRef.current = controller;
    chosenRateRef.current = session.playbackRate;
  }, [controller, session.playbackRate]);
  const [longPressActive, setLongPressActive] = useState(false);
  // Made on the first hold (never during render: it reads the refs above).
  const longPressRef = useRef<LongPressSpeed | null>(null);
  const endLongPress = useCallback(() => {
    longPressRef.current?.end();
  }, []);
  useEffect(
    () => () => {
      longPressRef.current?.end();
    },
    [],
  );
  const onLongPressStart = useCallback(() => {
    if (!longPressRef.current) {
      longPressRef.current = new LongPressSpeed({
        applyRate: (rate) => controllerRef.current.setPlaybackRate(rate),
        chosenRate: () => chosenRateRef.current,
        onChange: setLongPressActive,
      });
    }
    const started = longPressRef.current.start(session.isPlaying && session.isReady && !session.error && !locked);
    if (started) {
      hud.hideNow();
      AccessibilityInfo.announceForAccessibility(
        t('videoPlayer.longPressStarted', { rate: `${LONG_PRESS_PLAYBACK_RATE}×` }),
      );
    }
  }, [hud, locked, session.error, session.isPlaying, session.isReady, t]);

  const handlePictureInPictureStart = useCallback(() => {
    endLongPress();
    hud.hideNow();
    setPipActive(true);
    setPlayerSessionPictureInPicture(true);
    onPictureInPictureStart();
  }, [hud, endLongPress, onPictureInPictureStart]);
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
    // The P1 / P2 sheets and the frame panel hold the controls up like the speed sheet does.
    isSpeedSheetOpen: speedSheetOpen || optionsOpen || seekIntervalOpen || jumpOpen || frameMode || displaySheet != null,
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
    if (jumpOpen || seekIntervalOpen || optionsOpen || displaySheet) {
      setJumpOpen(false);
      setSeekIntervalOpen(false);
      setOptionsOpen(false);
      setDisplaySheet(null);
      return;
    }
    if (speedSheetOpen) {
      setSpeedSheetOpen(false);
      return;
    }
    if (orientationSheetOpen) {
      setOrientationSheetOpen(false);
      return;
    }
    if (frameMode) {
      setFrameMode(false);
      return;
    }
    if (isFullscreen) {
      void exitFullscreen();
      return;
    }
    void leavePlayer();
  }, [
    displaySheet,
    exitFullscreen,
    frameMode,
    isFullscreen,
    jumpOpen,
    leavePlayer,
    optionsOpen,
    orientationSheetOpen,
    seekIntervalOpen,
    speedSheetOpen,
  ]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (locked) {
        // A locked screen ignores Back too (pocket / child presses); the lock pill unlocks.
        return true;
      }
      if (jumpOpen || seekIntervalOpen || optionsOpen || displaySheet) {
        setJumpOpen(false);
        setSeekIntervalOpen(false);
        setOptionsOpen(false);
        setDisplaySheet(null);
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
      if (frameMode) {
        setFrameMode(false);
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
  }, [
    displaySheet,
    frameMode,
    handleAndroidBack,
    jumpOpen,
    leavePlayer,
    locked,
    optionsOpen,
    orientationSheetOpen,
    seekIntervalOpen,
    speedSheetOpen,
  ]);

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
    controller.seekBy(-seekStepSeconds);
  }, [bumpControls, controller, seekStepSeconds, session.isReady]);

  const onForward = useCallback(() => {
    bumpControls();
    if (!session.isReady) {
      return;
    }
    controller.seekBy(seekStepSeconds);
  }, [bumpControls, controller, seekStepSeconds, session.isReady]);

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
    endLongPress();
    showControls();
    setOrientationSheetOpen(false);
    setSpeedSheetOpen(true);
  }, [endLongPress, showControls]);

  const onCloseSpeed = useCallback(() => {
    setSpeedSheetOpen(false);
    bumpControls();
  }, [bumpControls]);

  const onOpenOrientation = useCallback(() => {
    endLongPress();
    showControls();
    setSpeedSheetOpen(false);
    setOrientationSheetOpen(true);
  }, [endLongPress, showControls]);

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

  const anyModalOpen =
    speedSheetOpen || orientationSheetOpen || optionsOpen || seekIntervalOpen || jumpOpen || displaySheet != null;

  const onSingleTap = useCallback(() => {
    if (anyModalOpen || session.isSeeking) {
      return;
    }
    toggleControls();
  }, [anyModalOpen, session.isSeeking, toggleControls]);

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

  const beginPreviewDrag = seekPreview.beginDrag;
  const onSeekStart = useCallback(
    (seconds: number) => {
      beginPreviewDrag();
      beginSeekPreview(seconds);
      showControls();
    },
    [beginPreviewDrag, beginSeekPreview, showControls],
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
    endLongPress();
    hud.hideNow();
    setSpeedSheetOpen(false);
    setOrientationSheetOpen(false);
    setOptionsOpen(false);
    setSeekIntervalOpen(false);
    setJumpOpen(false);
    setDisplaySheet(null);
    setFrameMode(false);
    setLocked(true);
  }, [hud, endLongPress, setLocked]);
  const onUnlock = useCallback(() => {
    setLocked(false);
    showControls();
  }, [setLocked, showControls]);

  // ── P1 Playback basics ─────────────────────────────────────────────────────────────────────────────────────────
  // Exact seeks go through the session's own seek (the timeline's path): the position and "finished" state update at
  // once, and nothing in the session code changes.
  const seekExact = useCallback(
    (seconds: number) => {
      beginSeekPreview(seconds);
      commitSeekPreview();
    },
    [beginSeekPreview, commitSeekPreview],
  );
  const canCommand = session.isReady && !session.error;

  /** #520 Stop: pause and go back to the start. */
  const onStop = useCallback(() => {
    endLongPress();
    if (!canCommand) {
      return;
    }
    controller.pause();
    seekExact(0);
    showControls();
    announcePlayer(t('videoPlayer.stopped'));
  }, [canCommand, controller, endLongPress, seekExact, showControls, t]);

  /** #532 Jump to time. */
  const onJump = useCallback(
    (seconds: number) => {
      setJumpOpen(false);
      if (!canCommand) {
        return;
      }
      seekExact(seconds);
      bumpControls();
      announcePlayer(t('videoPlayer.jumpedTo', { time: formatPlaybackTime(seconds) }));
    },
    [bumpControls, canCommand, seekExact, t],
  );

  /** #527: the chosen seek interval (remembered; the full-screen ⏪ / ⏩, "10 s" and double taps follow it). */
  const onSelectSeekInterval = useCallback(
    (seconds: SeekStepSeconds) => {
      setSeekStepSeconds(seconds);
      setSeekIntervalOpen(false);
      bumpControls();
    },
    [bumpControls],
  );

  // ── P2 Video fit & display ─────────────────────────────────────────────────────────────────────────────────────
  const openDisplaySheet = useCallback(
    (sheet: 'aspectRatio' | 'mirrorFlip') => {
      endLongPress();
      showControls();
      setDisplaySheet(sheet);
    },
    [endLongPress, showControls],
  );

  /** #564 Aspect ratio, #565 Crop to fill, #566 Stretch: remembered for this video. */
  const onSelectFit = useCallback(
    (fit: VideoFit) => {
      setDisplaySheet(null);
      setVideoFit(activeMediaId, fit);
      bumpControls();
      announcePlayer(videoFitLabel(t, fit));
    },
    [activeMediaId, bumpControls, t],
  );

  /** #573 Mirror / Flip: for this video, until another one plays. */
  const onSelectMirror = useCallback(
    (mode: MirrorMode) => {
      setDisplaySheet(null);
      setVideoMirror(activeMediaId, mode);
      bumpControls();
      announcePlayer(mirrorModeLabel(t, mode));
    },
    [activeMediaId, bumpControls, t],
  );

  /** The player's own clock (the session's position lags by up to a third of a second). */
  const positionRef = useRef(session.positionSeconds);
  useEffect(() => {
    positionRef.current = session.positionSeconds;
  }, [session.positionSeconds]);
  const readPlayerTime = useCallback(() => {
    try {
      const value = player.currentTime;
      return Number.isFinite(value) && value >= 0 ? value : positionRef.current;
    } catch {
      return positionRef.current;
    }
  }, [player]);

  /** #531 Frame by frame: pause, then show the panel on the frame that is showing. */
  const openFrameMode = useCallback(() => {
    endLongPress();
    if (!canCommand) {
      return;
    }
    if (session.isPlaying) {
      controller.pause();
    }
    lastFrameStepRef.current = null;
    setFrameShown(frameAt(readPlayerTime(), trackInfo.frameRate));
    setFrameMode(true);
    showControls();
  }, [canCommand, controller, endLongPress, readPlayerTime, session.isPlaying, showControls, trackInfo.frameRate]);

  const onFrameStep = useCallback(
    (direction: -1 | 1) => {
      if (!canCommand) {
        return;
      }
      if (session.isPlaying) {
        controller.pause();
      }
      const now = Date.now();
      const step = frameStep(
        frameStepBase(readPlayerTime(), lastFrameStepRef.current, now),
        direction,
        trackInfo.frameRate,
        session.durationSeconds,
      );
      if (!step) {
        return;
      }
      lastFrameStepRef.current = { target: step.seekSeconds, at: now };
      seekExact(step.seekSeconds);
      setFrameShown({ frameIndex: step.frameIndex, frameStartSeconds: step.frameStartSeconds });
    },
    [canCommand, controller, readPlayerTime, seekExact, session.durationSeconds, session.isPlaying, trackInfo.frameRate],
  );

  const onCloseFrameMode = useCallback(() => {
    setFrameMode(false);
    bumpControls();
  }, [bumpControls]);

  const openOptions = useCallback(() => {
    endLongPress();
    showControls();
    setSpeedSheetOpen(false);
    setOrientationSheetOpen(false);
    setOptionsOpen(true);
  }, [endLongPress, showControls]);

  /** Every chip, tile, row and menu entry of the page (see page/player-page-actions.ts for which is which). */
  const onPageAction = useCallback(
    (action: PlayerPageAction) => {
      if (NOT_YET_ACTIONS.has(action)) {
        notYet();
        return;
      }
      switch (action) {
        case 'speed':
          onOpenSpeed();
          return;
        case 'rotate':
          endLongPress();
          bumpControls();
          void toggleFullscreen();
          return;
        case 'lock':
          onLock();
          return;
        case 'skipBack':
          onRewind();
          return;
        case 'seekInterval':
          endLongPress();
          setSeekIntervalOpen(true);
          return;
        case 'frameByFrame':
          openFrameMode();
          return;
        case 'aspectRatio':
          openDisplaySheet('aspectRatio');
          return;
        case 'mirrorFlip':
          openDisplaySheet('mirrorFlip');
          return;
        default:
          notYet();
      }
    },
    [
      bumpControls,
      endLongPress,
      notYet,
      onLock,
      onOpenSpeed,
      onRewind,
      openDisplaySheet,
      openFrameMode,
      toggleFullscreen,
    ],
  );

  // The ⋮ options sheet (src/player/options): the rows registered by each package act through this context.
  const optionsUi = useMemo<PlayerOptionUi>(
    () => ({
      stop: onStop,
      openJumpToTime: () => {
        endLongPress();
        setJumpOpen(true);
      },
      openSeekInterval: () => {
        endLongPress();
        setSeekIntervalOpen(true);
      },
      openFrameByFrame: openFrameMode,
      openOrientation: onOpenOrientation,
      openSpeed: onOpenSpeed,
      saveToLibrary: () => {
        void onSaveToLibrary();
      },
      seekTo: seekExact,
      notAvailableYet: notYet,
      openAspectRatio: () => openDisplaySheet('aspectRatio'),
      openMirrorFlip: () => openDisplaySheet('mirrorFlip'),
      setFillCutout,
      setInfoOverlay,
    }),
    [
      endLongPress,
      notYet,
      onOpenOrientation,
      onOpenSpeed,
      onSaveToLibrary,
      onStop,
      openDisplaySheet,
      openFrameMode,
      seekExact,
    ],
  );

  // P2 #576: the app draws edge to edge, so in full screen the window reaches under the camera cutout. The controls
  // always keep clear of it; the picture does too unless "Use the notch area" is on. Not in picture-in-picture.
  const cutoutInsets = useMemo(
    () =>
      isFullscreen && !pipActive
        ? { top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left }
        : null,
    [insets.bottom, insets.left, insets.right, insets.top, isFullscreen, pipActive],
  );
  const pictureInsets = display.fillCutout ? null : cutoutInsets;
  // #721: what the info overlay shows (the box, the dock line and the page line read the same values).
  const videoInfo = useMemo(
    () => ({
      mimeType: trackInfo.mimeType,
      width: trackInfo.width,
      height: trackInfo.height,
      frameRate: trackInfo.frameRate,
      averageBitrate: trackInfo.averageBitrate,
      peakBitrate: trackInfo.peakBitrate,
      videoRange: trackInfo.videoRange,
      playbackRate: session.playbackRate,
    }),
    [session.playbackRate, trackInfo],
  );

  /** The page's tab bar: leave the Player (it carries on in the mini player) for that tab, like Back does. */
  const onPressTab = useCallback(
    (route: string) => {
      const path = TAB_PATHS[route];
      if (!path) {
        return;
      }
      endLongPress();
      if (sessionFailed) {
        closePlayerSession(sessionKey);
      }
      void restorePresentation().then(() => {
        appRouter.dismissTo(path as Parameters<typeof appRouter.dismissTo>[0]);
      });
    },
    [endLongPress, restorePresentation, sessionFailed, sessionKey],
  );

  const title = session.displayName ?? t('player.untitled');
  // Edit after download: the artist VidoraX keeps for this item (app-level tag), shown next to the title.
  const artist = useMediaArtist(activeMediaId);
  const showError = session.phase === 'error' && session.error != null;
  // #721: shown wherever the Player shows the video (not over an error, not in the small PiP window).
  const showInfo = display.infoOverlay && !showError && !pipActive;
  const overlayVisible = !locked && (controlsVisible || session.isSeeking || speedSheetOpen);
  const orientationIcon = resolveOrientationIcon(orientationMode);
  const playerSurfaceBg = theme.colors.black;
  const screenBg = showError ? theme.colors.background : playerSurfaceBg;

  // Screen 19: in portrait, out of full screen, the Player is a page — header, the video in a card, chips, tiles,
  // Up next and the tab bar. Full screen and landscape keep the black stage (the design draws no frame for them).
  // The video surface sits at the same place in the tree in both, so switching never remounts the player's view.
  // In picture-in-picture the window is the small PiP window: the picture alone, never the page around it.
  const pageLayout = !isFullscreen && !pipActive && window.height >= window.width && !showError;
  // Locked on the page: the controls under the lock overlay are hidden from TalkBack too, not only from touch.
  const pageA11yHidden = locked && pageLayout;
  const pageBg = theme.colors.background;
  const pageTopBg = theme.colors.headerStyle === 'band' ? theme.colors.headerBackground : pageBg;
  const card = playerCardSize(
    window.width - insets.left - insets.right - ds.space.screenX * 2,
    contentSize ?? (trackInfo.width && trackInfo.height ? { width: trackInfo.width, height: trackInfo.height } : null),
  );
  const quality = qualityLabel(trackInfo.width, trackInfo.height);
  const gesturesEnabled = !locked && !anyModalOpen && !startupCoverVisible;
  const optionsContext: PlayerOptionContext = {
    t,
    mediaId: activeMediaId,
    player,
    controller,
    session: {
      isReady: session.isReady,
      isPlaying: session.isPlaying,
      hasError: Boolean(session.error),
      positionSeconds: session.positionSeconds,
      durationSeconds: session.durationSeconds,
      playbackRate: session.playbackRate,
    },
    seekStepSeconds,
    orientationMode,
    incoming: incomingToken ? { saveState } : null,
    display,
    ui: optionsUi,
  };

  const body = (
    <View
      style={[
        styles.body,
        isFullscreen ? styles.fullscreenBody : null,
        { backgroundColor: pageLayout ? pageBg : playerSurfaceBg },
      ]}>
      {pageLayout ? (
        <View
          style={styles.pageHeader}
          importantForAccessibility={pageA11yHidden ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={pageA11yHidden}>
          <DsHeader
            title={t('videoPlayer.title')}
            onBack={onChromeBack}
            action={{
              icon: 'ellipsis-vertical',
              accessibilityLabel: t('videoPlayer.moreOptions'),
              accessibilityHint: t('videoPlayer.moreOptionsSectionsHint'),
              onPress: openOptions,
              testID: 'player-page-options',
            }}
            testID="player-page-header"
          />
        </View>
      ) : null}
      <View
        style={
          pageLayout
            ? [styles.card, { width: card.width, height: card.height, backgroundColor: playerSurfaceBg }]
            : [styles.stage, { backgroundColor: playerSurfaceBg }]
        }
        testID={pageLayout ? 'player-video-card' : 'player-stage'}>
        <PlayerVideoSurface
          player={player}
          gesturesEnabled={gesturesEnabled}
          brightnessGesturesEnabled={sideGestures.brightnessAvailable}
          seekStepSeconds={seekStepSeconds}
          onSingleTap={onSingleTap}
          onDoubleTapSeek={onDoubleTapSeek}
          onDoubleTapTogglePlay={onDoubleTapTogglePlay}
          onLongPressStart={onLongPressStart}
          onLongPressEnd={endLongPress}
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
          // P2: picture-in-picture always fits (its window has the video's own shape).
          fit={pipActive ? 'fit' : display.fit}
          mirror={display.mirror}
          pictureInsets={pictureInsets}
          pictureInPictureAutoEnter={pipAutoEnter}
          surfaceAttached={surface.attached}
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
        {/* Single chrome container — avoids cover→controls remount swap shimmer. Clear of the cutout (P2 #576). */}
        <View style={[StyleSheet.absoluteFill, cutoutInsets]} pointerEvents="box-none">
          {pageLayout ? (
            overlayVisible && !startupCoverVisible ? (
              <PlayerCardOverlay
                title={title}
                artist={artist}
                quality={quality}
                isPlaying={session.isPlaying}
                isReady={session.isReady}
                isLoading={session.isLoading && session.hasFirstFrame}
                isCompleted={session.isCompleted}
                disabled={Boolean(session.error)}
                onBack={onChromeBack}
                onOpenOptions={openOptions}
                onPrevious={onPrevious}
                onNext={onNext}
                onPlayPause={onPlayPause}
                onReplay={onReplay}
                positionSeconds={session.positionSeconds}
                durationSeconds={session.durationSeconds}
                previewSeconds={seekPreviewSeconds}
                previewFrame={seekPreview.frame}
                onSeekStart={onSeekStart}
                onSeekChange={updateSeekPreview}
                onSeekCommit={onSeekCommit}
                onSeekCancel={onSeekCancel}
              />
            ) : null
          ) : (
            <>
              {(startupCoverVisible || overlayVisible) && !showError && !locked ? (
                <PlayerTopBar
                  title={title}
                  artist={artist}
                  isFullscreen={isFullscreen}
                  visible
                  orientationIcon={orientationIcon}
                  onBack={onChromeBack}
                  onOpenOrientation={onOpenOrientation}
                  onToggleFullscreen={() => {
                    bumpControls();
                    void toggleFullscreen();
                  }}
                  onOpenOptions={openOptions}
                  save={
                    incomingToken
                      ? {
                          state: saveState,
                          onPress: () => {
                            bumpControls();
                            void onSaveToLibrary();
                          },
                        }
                      : null
                  }
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
                  seekStepSeconds={seekStepSeconds}
                />
              ) : null}
              {overlayVisible && !startupCoverVisible && !showError ? (
                <PlayerLockButton onLock={onLock} />
              ) : null}
            </>
          )}
        </View>
        {/* The feedback, the info overlay and the lock pill, clear of the camera cutout in full screen (P2 #576). */}
        <View style={[StyleSheet.absoluteFill, cutoutInsets, styles.overlayLayer]} pointerEvents="box-none">
          {/* #721, full screen with the controls hidden (with them showing it is a line in the dock). */}
          <VideoInfoOverlay
            visible={showInfo && !pageLayout && !overlayVisible && !session.isSeeking && !startupCoverVisible}
            info={videoInfo}
          />
          <SeekFeedbackOverlay
            previewSeconds={seekPreviewSeconds}
            durationSeconds={session.durationSeconds}
            visible={session.isSeeking}
          />
          <DoubleTapSeekFeedback side={doubleTapSide} seconds={seekStepSeconds} />
          <LongPressSpeedPill visible={longPressActive} />
          {locked && !showError && !pageLayout ? <PlayerLockedOverlay onUnlock={onUnlock} /> : null}
        </View>
      </View>

      {/* #721 on the page: one line under the video card, whether the card's controls show or not. */}
      {pageLayout && showInfo ? (
        <VideoInfoLine info={videoInfo} tone="onPage" style={styles.pageInfoLine} testID="player-info-line" />
      ) : null}
      {pageLayout ? (
        <PlayerPageBody
          playbackRate={session.playbackRate}
          seekStepSeconds={seekStepSeconds}
          enabled={!session.error}
          accessibilityHidden={pageA11yHidden}
          onAction={onPageAction}
        />
      ) : (overlayVisible || session.isSeeking) && !startupCoverVisible ? (
        <Box
          px={16}
          pl={cutoutInsets ? 16 + cutoutInsets.left : undefined}
          pr={cutoutInsets ? 16 + cutoutInsets.right : undefined}
          pb={isFullscreen ? 12 + (cutoutInsets?.bottom ?? 0) : 16}
          pt={8}
          gap={4}
          style={styles.timelineDock}>
          <PlayerTimeline
            positionSeconds={session.positionSeconds}
            durationSeconds={session.durationSeconds}
            previewSeconds={seekPreviewSeconds}
            previewFrame={seekPreview.frame}
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
              {showInfo ? (
                // #721 with the controls showing: between the volume button and the speed chip, never over them.
                <VideoInfoLine info={videoInfo} tone="onVideo" style={styles.dockInfoLine} testID="player-info-dock" />
              ) : null}
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
      {pageLayout ? (
        <View
          importantForAccessibility={pageA11yHidden ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={pageA11yHidden}>
          <DsTabBarView
            activeRoute={tabRouteNames.library}
            routes={DS_TAB_ROUTES}
            onPressTab={onPressTab}
            bottomInset={insets.bottom}
          />
        </View>
      ) : null}
      {/* Locked on the page: everything is covered (header, chips, tabs), not only the video. */}
      {locked && pageLayout ? <PlayerLockedOverlay onUnlock={onUnlock} /> : null}
      {frameMode && !locked ? (
        <FrameStepPanel
          frameStartSeconds={frameShown?.frameStartSeconds ?? null}
          frameIndex={frameShown?.frameIndex ?? null}
          disabled={!canCommand}
          onStep={onFrameStep}
          onClose={onCloseFrameMode}
          style={
            pageLayout
              ? [styles.framePanel, { bottom: ds.size.tabBar + 1 + insets.bottom + ds.space.grid }]
              : [styles.framePanel, styles.framePanelStage, cutoutInsets ? { top: 60 + cutoutInsets.top } : null]
          }
        />
      ) : null}
    </View>
  );

  return (
    <SafeAreaScreen
      padded={false}
      edges={isFullscreen ? [] : pageLayout ? ['left', 'right', 'top'] : ['left', 'right', 'top', 'bottom']}
      style={{ backgroundColor: pageLayout ? pageBg : screenBg }}
      safeAreaStyle={{ backgroundColor: pageLayout ? pageTopBg : screenBg }}>
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
          {!isStreamMediaId(activeMediaId) &&
          (session.error === 'UNSUPPORTED_MEDIA' ||
            session.error === 'PLAYBACK_FAILED' ||
            // A file from another app that this device cannot read may still open in that kind of app.
            (incomingToken != null && session.error === 'CORRUPT_MEDIA')) ? (
            <Button
              title={t('library.openWith')}
              onPress={() => { void openExternal(); }}
              disabled={externalOpenBusy}
              testID="player-open-externally"
            />
          ) : null}
          {externalOpenError ? <Text color="error">{externalOpenError}</Text> : null}
          {incomingToken ? (
            // Kept even when this device cannot play it: it then opens with another app from the library.
            <Button
              title={
                saveState === 'saved'
                  ? t('player.savedToLibrary')
                  : saveState === 'saving'
                    ? t('player.savingToLibrary')
                    : t('player.saveToLibrary')
              }
              variant="outline"
              disabled={saveState !== 'idle'}
              onPress={() => {
                void onSaveToLibrary();
              }}
              accessibilityHint={saveState === 'idle' ? t('player.saveToLibraryHint') : undefined}
              testID="player-error-save-to-library"
            />
          ) : null}
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
      <PlayerOptionsSheet
        visible={optionsOpen}
        context={optionsContext}
        onClose={() => setOptionsOpen(false)}
      />
      <SeekIntervalSheet
        visible={seekIntervalOpen}
        selected={seekStepSeconds}
        onSelect={onSelectSeekInterval}
        onClose={() => setSeekIntervalOpen(false)}
      />
      <JumpToTimeSheet
        visible={jumpOpen}
        positionSeconds={session.positionSeconds}
        durationSeconds={session.durationSeconds}
        onJump={onJump}
        onClose={() => setJumpOpen(false)}
      />
      <AspectRatioSheet
        visible={displaySheet === 'aspectRatio'}
        selected={display.fit}
        onSelect={onSelectFit}
        onClose={() => setDisplaySheet(null)}
      />
      <MirrorFlipSheet
        visible={displaySheet === 'mirrorFlip'}
        selected={display.mirror}
        onSelect={onSelectMirror}
        onClose={() => setDisplaySheet(null)}
      />
    </SafeAreaScreen>
  );
});

const SAVE_OUTCOME_MESSAGE: Record<SaveIncomingOutcome['kind'], TranslationKey> = {
  saved: 'player.savedToLibrary',
  duplicate: 'player.alreadyInLibrary',
  no_space: 'player.saveNoSpace',
  unavailable: 'player.saveUnavailable',
  unsafe: 'fileSafety.saveRefused',
  failed: 'player.saveFailed',
};

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
  pageHeader: {
    paddingHorizontal: ds.space.screenX,
  },
  // Screen 19's video card: 12 dp under the header, rounded like every card, the picture clipped to it.
  card: {
    alignSelf: 'center',
    marginTop: ds.space.stack,
    borderRadius: ds.radius.card,
    overflow: 'hidden',
    position: 'relative',
  },
  framePanel: {
    position: 'absolute',
    left: ds.space.screenX,
    right: ds.space.screenX,
    zIndex: 8,
  },
  // Full screen / landscape: under the top bar, centred, clear of the timeline dock.
  framePanelStage: {
    top: 60,
    left: '18%',
    right: '18%',
  },
  // Above the startup cover and the chrome, as the lock overlay and the 2× pill were before they were grouped.
  overlayLayer: {
    zIndex: 10,
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
  dockInfoLine: {
    flex: 1,
    paddingHorizontal: 8,
  },
  pageInfoLine: {
    paddingHorizontal: ds.space.screenX,
    paddingTop: ds.space.grid,
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
