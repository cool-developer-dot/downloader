/**
 * Stage 2 player screen — composition / chrome only.
 * Session, resolver, and engine stay in `@/player`; the session itself runs in the app-wide PlayerSessionHost, so
 * leaving this screen keeps the same player (and position) going in the in-app mini player.
 */

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { MAX_SUBTITLE_BYTES, usePlayerSubtitles } from '@/player/subtitles/use-player-subtitles';
import { subtitleEncodingLabel } from '@/player/subtitles/subtitle-labels';
import type { SubtitleSource } from '@/player/subtitles/subtitle-record';
import { resetSubtitleStyle, setSubtitleStyle, useSubtitleStyle } from '@/player/subtitles/subtitle-style-preference';
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
import {
  movePlayQueueItem,
  removeFromPlayQueue,
  setPlayQueueShuffle,
  usePlayQueueNeighbours,
} from '@/player/play-queue';
import { setAutoPlayNext, setNextEpisodePrompt } from '@/player/auto-next-preference';
import { nextEpisodePromptState } from '@/player/next-episode-prompt';
import { queueMediaTitle } from '@/player/queue-media';
import { showAppDialog } from '@/components/modals/app-dialog';
import { deleteLoop, renameLoop, saveLoop } from '@/player/repeat-preference';
import { MAX_SAVED_LOOPS_PER_VIDEO, nextLoopName, type SavedLoop } from '@/player/saved-loops';
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
import { resetControlsLayout, setControlsLayout, useControlsLayout } from '@/player/controls-layout-preference';
import { SWITCHABLE_GESTURES, gesturesOnCount } from '@/player/gesture-settings';
import {
  resetGestureSettings,
  setGestureOn,
  setGestureSensitivity,
  setGesturesEnabled,
  useGestureSettings,
} from '@/player/gesture-settings-preference';
import { useSwipeSeek } from '@/player/use-swipe-seek';
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
import { SubtitleOverlay } from './page/SubtitleOverlay';
import { SubtitleEncodingSheet, SubtitleSyncSheet, SubtitleTrackSheet } from './page/SubtitleSheets';
import { SubtitleStyleSheet } from './page/SubtitleStyleSheet';
import { AbRepeatSheet, EndOfPlaybackSheet, LoopNameModal } from './page/RepeatSheets';
import { useContinueAfterAutoAdvance, usePlayerRepeat } from './page/use-repeat';
import { NextEpisodeCard } from './page/NextEpisodeCard';
import { QueueSheet } from './page/QueueSheet';
import { usePlayerQueueContext } from './page/use-queue';
// P7 Playlists: ⋮ → Tools → Add to playlist.
import { AddToPlaylistSheet } from '@/screens/playlists/components/AddToPlaylistSheet';
import { usePlayerPlaylistAdd } from './page/use-player-playlist-add';
import { SwipeSeekHud } from './components/SwipeSeekHud';
import { CustomizeControlsSheet } from './page/CustomizeControlsSheet';
import { GestureSensitivitySheet, GesturesSheet } from './page/GestureSheets';
import { fullscreenDockButtons, fullscreenTopButtons, fullscreenVideoButtons } from './page/player-controls-customize';
// P9 Library stats & bookmarks: Disable History, video bookmarks (sheet, name dialog, timeline dots), Quick Delete.
import { usePlayerLibraryStats } from './page/use-player-library-stats';
import { VideoBookmarksSheet } from './page/VideoBookmarksSheet';
import { BookmarkNameModal } from './page/BookmarkNameModal';
// P10 Screenshot & edit tools: ⋮ → Tools → Screenshot, Trim video, Extract audio, Video converter, Compress video.
import { PlayerEditToolsSheets } from './page/PlayerEditToolsSheets';
import { usePlayerEditTools } from './page/use-player-edit-tools';
import { usePlayerEngine } from '@/player/engine/use-player-engine';
import { PlayerEngineSheets } from './engine/PlayerEngineSheets';

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
  // P3: the subtitles of this video (tracks, the file showing, its lines now) and which subtitle sheet is open.
  const subtitles = usePlayerSubtitles(player, activeMediaId);
  // P4: the subtitle style (app-wide).
  const subtitleStyle = useSubtitleStyle();
  const [subtitleSheet, setSubtitleSheet] = useState<
    'subtitles' | 'tracks' | 'sync' | 'encoding' | 'style' | 'second' | null
  >(null);
  // P5: which repeat sheet is open, and the loop-name dialog (saving the A-B loop, or renaming a saved one).
  const [repeatSheet, setRepeatSheet] = useState<'endOfPlayback' | 'abRepeat' | null>(null);
  const [loopNaming, setLoopNaming] = useState<{ mode: 'save' } | { mode: 'rename'; loop: SavedLoop } | null>(null);
  // P6: the queue sheet ("Up next").
  const [queueSheetOpen, setQueueSheetOpen] = useState(false);
  // P8: the Gestures, Gesture sensitivity or Customize controls sheet.
  const [p8Sheet, setP8Sheet] = useState<'gestures' | 'sensitivity' | 'customize' | null>(null);
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

  // P8: the gesture settings (app-wide): which gestures work, and how far a swipe moves (#586).
  const gestureSettings = useGestureSettings();

  const sideGestures = usePlayerSideGestures({
    surfaceHeight,
    brightness,
    volume,
    sensitivity: gestureSettings.sensitivity,
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
  // P3: the subtitle file picker sends VidoraX to the background; that is not "leaving", so no PiP window meanwhile.
  const pipAutoEnter = pipActive || (pipArmedNow && !subtitles.picking);
  const subtitlePicking = subtitles.picking;
  useEffect(() => {
    setPictureInPictureArmed(pipAutoEnter);
    armNativePictureInPicture(pipAutoEnter, contentSize);
    // `subtitlePicking`: armed again after the subtitle picker, which disarms directly (see onLoadSubtitle).
  }, [contentSize, pipAutoEnter, setPictureInPictureArmed, subtitlePicking]);
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
    isSpeedSheetOpen:
      speedSheetOpen ||
      optionsOpen ||
      seekIntervalOpen ||
      jumpOpen ||
      frameMode ||
      displaySheet != null ||
      subtitleSheet != null ||
      p8Sheet != null,
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
    if (jumpOpen || seekIntervalOpen || optionsOpen || displaySheet || subtitleSheet || p8Sheet) {
      setJumpOpen(false);
      setSeekIntervalOpen(false);
      setOptionsOpen(false);
      setDisplaySheet(null);
      setSubtitleSheet(null);
      setP8Sheet(null);
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
    p8Sheet,
    seekIntervalOpen,
    speedSheetOpen,
    subtitleSheet,
  ]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (locked) {
        // A locked screen ignores Back too (pocket / child presses); the lock pill unlocks.
        return true;
      }
      if (jumpOpen || seekIntervalOpen || optionsOpen || displaySheet || subtitleSheet || p8Sheet) {
        setJumpOpen(false);
        setSeekIntervalOpen(false);
        setOptionsOpen(false);
        setDisplaySheet(null);
        setSubtitleSheet(null);
        setP8Sheet(null);
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
    p8Sheet,
    seekIntervalOpen,
    speedSheetOpen,
    subtitleSheet,
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

  // ── P7 Playlists ───────────────────────────────────────────────────────────────────────────────────────────────
  // ⋮ → Tools → Add to playlist: the playing video into one of the user's playlists (src/playlists).
  const p7Playlists = usePlayerPlaylistAdd({ mediaId: activeMediaId, title: session.displayName, endLongPress });
  // ── end P7 ─────────────────────────────────────────────────────────────────────────────────────────────────────

  // ── P9 Library stats & bookmarks ───────────────────────────────────────────────────────────────────────────────
  // ⋮ → Playback → Don't save watch history (#687); ⋮ → Tools → Add bookmark / Bookmarks (#705, dots on the timeline)
  // and Delete video (#726: the Library's delete, then the next video or the Player closes). Play counts (#708) are
  // counted app-wide from the playback events (src/library/ensure-library-stats.ts), not here.
  const p9 = usePlayerLibraryStats({
    mediaId: activeMediaId,
    title: session.displayName,
    player,
    controller,
    positionSeconds: session.positionSeconds,
    durationSeconds: session.durationSeconds,
    ready: session.isReady && !session.error,
    beginSeekPreview,
    commitSeekPreview,
    bumpControls,
    endLongPress,
    sessionKey,
    restorePresentation,
    router,
  });
  const closeP9Sheets = p9.closeSheets;
  // ── end P9 ─────────────────────────────────────────────────────────────────────────────────────────────────────

  // ── P10 Screenshot & edit tools ────────────────────────────────────────────────────────────────────────────────
  // ⋮ → Tools: Screenshot (#675) for files on the phone; Trim (#677), Extract audio (#678), Video converter (#679) and
  // Compress (#680) for library videos only. The edits pause the video and keep it paused while they run.
  const p10EditTools = usePlayerEditTools({
    mediaId: activeMediaId,
    title: session.displayName,
    player,
    controller,
    isPlaying: session.isPlaying,
    hasVideoFrame: session.hasFirstFrame,
    incoming: incomingToken != null,
    positionSeconds: session.positionSeconds,
    endLongPress,
    restorePresentation,
  });
  const p10CloseSheets = p10EditTools.closeSheets;
  // ── end P10 ────────────────────────────────────────────────────────────────────────────────────────────────────

  const anyModalOpen =
    speedSheetOpen ||
    orientationSheetOpen ||
    optionsOpen ||
    seekIntervalOpen ||
    jumpOpen ||
    displaySheet != null ||
    subtitleSheet != null ||
    repeatSheet != null ||
    loopNaming != null ||
    queueSheetOpen ||
    p7Playlists.sheetOpen ||
    p8Sheet != null ||
    p9.sheetOpen ||
    p10EditTools.sheetOpen;

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
    setSubtitleSheet(null);
    setRepeatSheet(null);
    setLoopNaming(null);
    setQueueSheetOpen(false);
    setP8Sheet(null);
    closeP9Sheets();
    setFrameMode(false);
    p10CloseSheets();
    setLocked(true);
  }, [hud, endLongPress, setLocked, closeP9Sheets, p10CloseSheets]);
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

  // ── P5 Repeat & loops ──────────────────────────────────────────────────────────────────────────────────────────
  // The A-B loop of this video, saved loops, and what the end of the video does (src/player/end-of-playback.ts).
  // P6: the queue, Shuffle, Auto Play Next (with its folder fallback) and the Next Episode card's Cancel feed it.
  const queueCtx = usePlayerQueueContext(activeMediaId);
  const repeat = usePlayerRepeat({
    player,
    controller,
    mediaId: activeMediaId,
    isReady: session.isReady,
    isPlaying: session.isPlaying,
    isSeeking: session.isSeeking,
    hasError: Boolean(session.error),
    durationSeconds: session.durationSeconds,
    replay,
    seekExact,
    queue: queueCtx.queue,
    goToMedia,
    autoPlayNext: queueCtx.autoPlayNext,
    folderNextId: queueCtx.folderNextId,
    advanceCancelled: queueCtx.advanceCancelled,
  });
  useContinueAfterAutoAdvance({
    controller,
    mediaId: activeMediaId,
    isReady: session.isReady,
    isPlaying: session.isPlaying,
    hasError: Boolean(session.error),
  });
  const repeatOnTile = repeat.onTile;

  // ── P6 Queue & auto-next ───────────────────────────────────────────────────────────────────────────────────────
  const onShuffle = useCallback(
    (on: boolean) => {
      setPlayQueueShuffle(on);
      announcePlayer(t(on ? 'videoPlayer.shuffleOn' : 'videoPlayer.shuffleOff'));
    },
    [t],
  );
  const onAutoPlayNext = useCallback(
    (on: boolean) => {
      setAutoPlayNext(on);
      announcePlayer(t(on ? 'videoPlayer.autoNextOn' : 'videoPlayer.autoNextOff'));
    },
    [t],
  );
  const upcomingNextId = repeat.upcoming.kind === 'next' ? repeat.upcoming.mediaId : null;
  // #733: "Next: …" in the last seconds, only when the end is about to play the next episode anyway.
  const nextEpisode = nextEpisodePromptState({
    enabled: queueCtx.nextEpisodePrompt,
    upcoming: repeat.upcoming,
    currentTitle: session.displayName ?? (activeMediaId ? queueMediaTitle(queueCtx.index, activeMediaId) : null),
    nextTitle: upcomingNextId ? queueMediaTitle(queueCtx.index, upcomingNextId) : null,
    positionSeconds: session.positionSeconds,
    durationSeconds: session.durationSeconds,
    cancelled: queueCtx.advanceCancelled,
    ready: canCommand,
  });
  const cancelAdvance = queueCtx.cancelAdvance;
  const onCancelNextEpisode = useCallback(() => {
    cancelAdvance();
    announcePlayer(t('videoPlayer.nextEpisodeCancelled'));
  }, [cancelAdvance, t]);
  const onSaveLoop = useCallback(
    (name: string) => {
      setLoopNaming(null);
      const { a, b } = repeat.points;
      if (!activeMediaId || a == null || b == null) {
        return;
      }
      const result = saveLoop(activeMediaId, name, Math.min(a, b), Math.max(a, b));
      if (result.ok) {
        announcePlayer(t('videoPlayer.loopSaved', { name: result.loop.name }));
      } else if (result.reason === 'full') {
        announcePlayer(t('videoPlayer.loopsFull', { max: MAX_SAVED_LOOPS_PER_VIDEO }));
      }
    },
    [activeMediaId, repeat.points, t],
  );
  const onRenameLoop = useCallback(
    (loop: SavedLoop, name: string) => {
      setLoopNaming(null);
      if (activeMediaId) {
        renameLoop(activeMediaId, loop.id, name);
      }
    },
    [activeMediaId],
  );
  const onDeleteLoop = useCallback(
    (loop: SavedLoop) => {
      const mediaIdNow = activeMediaId;
      if (!mediaIdNow) {
        return;
      }
      void showAppDialog({
        title: t('videoPlayer.loopDeleteTitle'),
        message: t('videoPlayer.loopDeleteMessage', { name: loop.name }),
        confirmLabel: t('videoPlayer.loopDeleteConfirm'),
        cancelLabel: t('common.cancel'),
        variant: 'error',
      }).then((confirmed) => {
        if (confirmed) {
          deleteLoop(mediaIdNow, loop.id);
          announcePlayer(t('videoPlayer.loopDeleted'));
        }
      });
    },
    [activeMediaId, t],
  );

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

  // ── P3 Subtitles ───────────────────────────────────────────────────────────────────────────────────────────────
  const openSubtitleSheet = useCallback(
    (sheet: 'subtitles' | 'tracks' | 'sync' | 'encoding' | 'style' | 'second') => {
      endLongPress();
      showControls();
      setSubtitleSheet(sheet);
    },
    [endLongPress, showControls],
  );

  const selectSubtitles = subtitles.select;
  /** #598 / #602: a track (or Off) for this video, remembered. */
  const onSelectSubtitle = useCallback(
    (source: SubtitleSource) => {
      setSubtitleSheet(null);
      selectSubtitles(source);
      bumpControls();
      if (source.kind === 'off') {
        announcePlayer(t('videoPlayer.subtitleOff'));
      }
    },
    [bumpControls, selectSubtitles, t],
  );

  const loadSubtitles = subtitles.load;
  /** #589: the file picker; a toast says what happened. */
  const onLoadSubtitle = useCallback(async () => {
    endLongPress();
    // Disarmed now, before the picker opens: the `picking` state reaches the arming effect only after a render, and
    // the picker may already be in front by then. The effect arms again once picking is over.
    armNativePictureInPicture(false, null);
    setPictureInPictureArmed(false);
    const result = await loadSubtitles();
    switch (result.kind) {
      case 'loaded':
        announcePlayer(t('videoPlayer.subtitleLoaded', { name: result.name ?? '' }));
        return;
      case 'too_big':
        announcePlayer(t('videoPlayer.subtitleTooBig', { size: `${Math.round(MAX_SUBTITLE_BYTES / 1024 / 1024)} MB` }));
        return;
      case 'not_subtitle':
        announcePlayer(t('videoPlayer.subtitleNotSubtitle'));
        return;
      case 'failed':
        announcePlayer(t('videoPlayer.subtitleLoadFailed'));
        return;
      default:
    }
  }, [endLongPress, loadSubtitles, setPictureInPictureArmed, t]);

  // A remembered file that can no longer be read (deleted, moved): said once.
  const subtitleFailed = subtitles.loaded?.failed === true;
  useEffect(() => {
    if (subtitleFailed) {
      announcePlayer(t('videoPlayer.subtitleUnreadable'));
    }
  }, [subtitleFailed, t]);

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

  // ── P8 Gestures & custom controls ──────────────────────────────────────────────────────────────────────────────
  const controlsLayout = useControlsLayout();
  const openP8Sheet = useCallback(
    (sheet: 'gestures' | 'sensitivity' | 'customize') => {
      endLongPress();
      showControls();
      setP8Sheet(sheet);
    },
    [endLongPress, showControls],
  );
  const closeP8Sheet = useCallback(() => {
    setP8Sheet(null);
    bumpControls();
  }, [bumpControls]);

  /** #586: from the sensitivity sheet (the Gestures sheet sets it in place). */
  const onSelectGestureSensitivity = useCallback(
    (sensitivity: Parameters<typeof setGestureSensitivity>[0]) => {
      setGestureSensitivity(sensitivity);
      closeP8Sheet();
    },
    [closeP8Sheet],
  );

  /** #582: a sideways swipe shows the target and seeks (through the session's exact seek) when the finger lifts. */
  const hideAdjustmentHud = useCallback(() => hud.hideNow(), [hud]);
  const swipeSeek = useSwipeSeek({
    durationSeconds: session.durationSeconds,
    sensitivity: gestureSettings.sensitivity,
    readPositionSeconds: readPlayerTime,
    seekTo: seekExact,
    onBegin: hideAdjustmentHud,
  });
  const swipeSeekAvailable = canCommand && session.durationSeconds != null && session.durationSeconds > 0;

  // #692: the full-screen buttons the user chose (nothing saved: all of them, in today's places).
  const topBarButtons = useMemo(() => fullscreenTopButtons(controlsLayout), [controlsLayout]);
  const videoButtons = useMemo(() => fullscreenVideoButtons(controlsLayout), [controlsLayout]);
  const dockButtons = useMemo(() => fullscreenDockButtons(controlsLayout), [controlsLayout]);

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
        case 'subs':
          openSubtitleSheet('subtitles');
          return;
        case 'upNext':
          // P6 #619: the queue sheet.
          endLongPress();
          setQueueSheetOpen(true);
          return;
        case 'abRepeat':
          // P5 #541: set A, then B; once the loop is on, the A-B sheet.
          endLongPress();
          if (repeatOnTile()) {
            setRepeatSheet('abRepeat');
          }
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
      openSubtitleSheet,
      repeatOnTile,
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
      openSubtitleTracks: () => openSubtitleSheet('tracks'),
      loadSubtitleFile: () => {
        void onLoadSubtitle();
      },
      setSubtitleAutoDetect: subtitles.setAutoDetect,
      openSubtitleSync: () => openSubtitleSheet('sync'),
      openSubtitleEncoding: () => openSubtitleSheet('encoding'),
      subtitlesOff: () => onSelectSubtitle({ kind: 'off' }),
      openSubtitleStyle: () => openSubtitleSheet('style'),
      openSubtitleSecond: () => openSubtitleSheet('second'),
      openEndOfPlayback: () => {
        endLongPress();
        setRepeatSheet('endOfPlayback');
      },
      openAbRepeat: () => {
        endLongPress();
        setRepeatSheet('abRepeat');
      },
      openQueue: () => {
        endLongPress();
        setQueueSheetOpen(true);
      },
      setShuffle: onShuffle,
      setAutoPlayNext: onAutoPlayNext,
      setNextEpisodePrompt,
      openGestures: () => openP8Sheet('gestures'),
      setGesturesEnabled,
      openGestureSensitivity: () => openP8Sheet('sensitivity'),
      openCustomizeControls: () => openP8Sheet('customize'),
    }),
    [
      onAutoPlayNext,
      onShuffle,
      endLongPress,
      notYet,
      onLoadSubtitle,
      onOpenOrientation,
      onOpenSpeed,
      onSaveToLibrary,
      onSelectSubtitle,
      onStop,
      openDisplaySheet,
      openFrameMode,
      openP8Sheet,
      openSubtitleSheet,
      seekExact,
      subtitles.setAutoDetect,
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
  // #721's box: full screen, controls hidden. A top subtitle (P4) keeps below it.
  const infoBoxVisible = showInfo && !pageLayout && !overlayVisible && !session.isSeeking && !startupCoverVisible;
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
  // Faran's P14–P19 (streams, keys, speed, audio, timers, effects): their native settings, rows and sheets.
  const leaveToDownloads = useCallback(() => onPressTab(tabRouteNames.downloads), [onPressTab]);
  const engine = usePlayerEngine({
    player,
    mediaId: activeMediaId,
    isReady: session.isReady,
    isPlaying: session.isPlaying,
    leaveToDownloads,
  });
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
    subtitles: {
      label: subtitles.currentLabel,
      isFile: subtitles.currentFile != null,
      offsetMs: subtitles.offsetMs,
      encodingLabel: subtitles.currentFile
        ? subtitleEncodingLabel(t, subtitles.currentFile.encoding, subtitles.loaded?.encoding ?? null)
        : null,
      autoDetect: subtitles.autoDetect,
      secondLabel: subtitles.secondaryLabel,
    },
    repeat: { endActionLabel: repeat.endActionLabel, abLabel: repeat.abLabel },
    queue: {
      countLabel: t('videoPlayer.queueCount', { count: queueCtx.queue.length }),
      size: queueCtx.queue.length,
      shuffled: queueCtx.shuffled,
      autoPlayNext: queueCtx.autoPlayNext,
      nextEpisodePrompt: queueCtx.nextEpisodePrompt,
    },
    playlists: p7Playlists.option,
    p9: p9.option,
    gestures: {
      enabled: gestureSettings.enabled,
      sensitivity: gestureSettings.sensitivity,
      onCount: gesturesOnCount(gestureSettings),
      total: SWITCHABLE_GESTURES.length,
    },
    editTools: p10EditTools.option,
    engine: engine.option,
    ui: optionsUi,
  };

  // #721 with the controls showing: between the volume button and the speed chip (P8: after the first dock button),
  // never over them.
  const dockInfoLine = (
    <VideoInfoLine info={videoInfo} tone="onVideo" style={styles.dockInfoLine} testID="player-info-dock" />
  );

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
          gestureSettings={gestureSettings}
          swipeSeekAvailable={swipeSeekAvailable}
          onSwipeSeekStart={swipeSeek.onStart}
          onSwipeSeekUpdate={swipeSeek.onUpdate}
          onSwipeSeekFinalize={swipeSeek.onFinalize}
          onTwoFingerTap={onPlayPause}
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
        <SwipeSeekHud hud={swipeSeek.hud} />
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
                loopMarkers={repeat.markers}
                onClearLoop={repeat.clear}
                bookmarkMarkers={p9.markers}
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
                  buttons={topBarButtons}
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
                  showSkipButtons={videoButtons.skipButtons}
                  showPreviousNext={videoButtons.previousNext}
                />
              ) : null}
              {overlayVisible && !startupCoverVisible && !showError && videoButtons.lock ? (
                <PlayerLockButton onLock={onLock} />
              ) : null}
            </>
          )}
        </View>
        {/* The feedback, the info overlay and the lock pill, clear of the camera cutout in full screen (P2 #576). */}
        <View style={[StyleSheet.absoluteFill, cutoutInsets, styles.overlayLayer]} pointerEvents="box-none">
          {/*
            P3 / P4: subtitle files in the user's style. Clear of what shows over the picture: the card's timeline and
            top row, the full-screen top bar, and the info box at the top end.
          */}
          {!showError && !startupCoverVisible ? (
            <SubtitleOverlay
              primaryCues={subtitles.lines}
              secondaryCues={subtitles.secondaryLines}
              primaryFile={subtitles.currentFile != null}
              primaryNative={subtitles.current.kind === 'embedded'}
              secondaryOn={subtitles.secondaryKey !== 'off'}
              style={subtitleStyle}
              areaHeight={surfaceHeight}
              insetBottom={pageLayout && overlayVisible ? 48 : 0}
              insetTop={
                pageLayout
                  ? overlayVisible
                    ? 44
                    : 0
                  : overlayVisible
                    ? 64
                    : infoBoxVisible
                      ? INFO_BOX_CLEARANCE
                      : 0
              }
            />
          ) : null}
          {/* #721, full screen with the controls hidden (with them showing it is a line in the dock). */}
          <VideoInfoOverlay visible={infoBoxVisible} info={videoInfo} />
          <SeekFeedbackOverlay
            previewSeconds={seekPreviewSeconds}
            durationSeconds={session.durationSeconds}
            visible={session.isSeeking}
          />
          <DoubleTapSeekFeedback side={doubleTapSide} seconds={seekStepSeconds} />
          <LongPressSpeedPill visible={longPressActive} />
          {/* P6 #733: the Next Episode card, above the controls along the bottom while they show. */}
          <NextEpisodeCard
            visible={nextEpisode.visible && !locked && !pipActive && !showError}
            title={nextEpisode.visible ? nextEpisode.nextTitle : ''}
            secondsLeft={nextEpisode.visible ? nextEpisode.secondsLeft : 0}
            bottom={pageLayout ? (overlayVisible ? 56 : 12) : overlayVisible ? 120 : 16}
            onPlayNow={() => {
              if (nextEpisode.visible) {
                goToMedia(nextEpisode.nextId);
              }
            }}
            onCancel={onCancelNextEpisode}
          />
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
          layout={controlsLayout}
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
            loopMarkers={repeat.markers}
            onClearLoop={repeat.clear}
            bookmarkMarkers={p9.markers}
          />
          {session.isSeeking ? null : (
            <Box row style={styles.dockActions}>
              {/* P8 #692: the user's buttons in their order (nothing saved: volume, then speed), the info line after the first. */}
              {dockButtons.map((button, index) => (
                <Fragment key={button}>
                  {button === 'mute' ? (
                    <IconButton
                      icon={resolveVolumeIcon(volumeLevel, isMuted)}
                      size="small"
                      variant="ghost"
                      color={session.error ? 'disabled' : 'inverse'}
                      accessibilityLabel={isMuted ? t('player.unmute') : t('player.mute')}
                      disabled={Boolean(session.error)}
                      onPress={onToggleMute}
                    />
                  ) : (
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
                  )}
                  {index === 0 && showInfo ? dockInfoLine : null}
                </Fragment>
              ))}
              {dockButtons.length === 0 && showInfo ? dockInfoLine : null}
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
      {/* P3: the Subs chip opens the options sheet's Subtitles section alone. */}
      <PlayerOptionsSheet
        visible={subtitleSheet === 'subtitles'}
        context={optionsContext}
        onClose={() => setSubtitleSheet(null)}
        only="subtitles"
        title={t('videoPlayer.chipSubsA11y')}
        testID="player-subtitles-sheet"
      />
      <SubtitleTrackSheet
        visible={subtitleSheet === 'tracks'}
        title={t('videoPlayer.subtitleTrack')}
        options={subtitles.options}
        selectedKey={subtitles.currentKey}
        onSelect={onSelectSubtitle}
        onClose={() => setSubtitleSheet(null)}
      />
      <SubtitleSyncSheet
        visible={subtitleSheet === 'sync'}
        offsetMs={subtitles.offsetMs}
        onStep={subtitles.stepOffset}
        onReset={subtitles.resetOffset}
        onClose={() => setSubtitleSheet(null)}
      />
      <SubtitleStyleSheet
        visible={subtitleSheet === 'style'}
        style={subtitleStyle}
        showSecond={subtitles.secondaryKey !== 'off'}
        onChange={setSubtitleStyle}
        onReset={resetSubtitleStyle}
        onClose={() => setSubtitleSheet(null)}
      />
      <SubtitleTrackSheet
        visible={subtitleSheet === 'second'}
        title={t('videoPlayer.subtitleSecond')}
        subtitle={t('videoPlayer.subtitleSecondSheetHint')}
        options={subtitles.options}
        selectedKey={subtitles.secondaryKey}
        filesOnly
        exclude={[subtitles.currentKey]}
        onSelect={(source) => {
          setSubtitleSheet(null);
          subtitles.selectSecondary(source);
          bumpControls();
        }}
        onClose={() => setSubtitleSheet(null)}
        testID="player-subtitle-second-sheet"
      />
      <SubtitleEncodingSheet
        visible={subtitleSheet === 'encoding'}
        selected={subtitles.currentFile?.encoding ?? 'auto'}
        detected={subtitles.loaded?.encoding ?? null}
        onSelect={(encoding) => {
          setSubtitleSheet(null);
          subtitles.setEncoding(encoding);
        }}
        onClose={() => setSubtitleSheet(null)}
      />
      {/* P5: When the video ends, A-B repeat with its saved loops, and a loop's name. */}
      <EndOfPlaybackSheet
        visible={repeatSheet === 'endOfPlayback'}
        selected={repeat.endAction}
        onSelect={(action) => {
          setRepeatSheet(null);
          repeat.setEndAction(action);
        }}
        onClose={() => setRepeatSheet(null)}
      />
      <AbRepeatSheet
        visible={repeatSheet === 'abRepeat' && loopNaming == null}
        points={repeat.points}
        positionSeconds={session.positionSeconds}
        durationSeconds={session.durationSeconds}
        enabled={canCommand}
        loops={repeat.loops}
        onSetA={repeat.setA}
        onSetB={repeat.setB}
        onClear={repeat.clear}
        onSave={() => setLoopNaming({ mode: 'save' })}
        onPlayLoop={(loop) => {
          setRepeatSheet(null);
          repeat.playLoop(loop);
        }}
        onRenameLoop={(loop) => setLoopNaming({ mode: 'rename', loop })}
        onDeleteLoop={onDeleteLoop}
        onClose={() => setRepeatSheet(null)}
      />
      <LoopNameModal
        visible={loopNaming != null}
        title={loopNaming?.mode === 'rename' ? t('videoPlayer.loopRenameTitle') : t('videoPlayer.abSaveTitle')}
        initialName={
          loopNaming?.mode === 'rename'
            ? loopNaming.loop.name
            : nextLoopName(repeat.loops, t('videoPlayer.loopDefaultName'))
        }
        onSave={(name) => {
          if (loopNaming?.mode === 'rename') {
            onRenameLoop(loopNaming.loop, name);
          } else {
            onSaveLoop(name);
          }
        }}
        onClose={() => setLoopNaming(null)}
      />
      {/* P6 #619 / #542 / #534: the queue ("Up next"). */}
      <QueueSheet
        visible={queueSheetOpen}
        ids={queueCtx.queue}
        currentId={activeMediaId}
        index={queueCtx.index}
        shuffled={queueCtx.shuffled}
        autoPlayNext={queueCtx.autoPlayNext}
        onShuffle={onShuffle}
        onAutoPlayNext={onAutoPlayNext}
        onPlay={(id) => {
          setQueueSheetOpen(false);
          goToMedia(id);
        }}
        onMove={movePlayQueueItem}
        onRemove={(id) => {
          removeFromPlayQueue(id);
          announcePlayer(t('videoPlayer.queueRemoved'));
        }}
        onClose={() => setQueueSheetOpen(false)}
      />
      {/* P7: Add to playlist (the playing video). */}
      <AddToPlaylistSheet inputs={p7Playlists.inputs} onClose={p7Playlists.closeSheet} testID="player-add-to-playlist" />
      {/* P8: Gestures (#582–#587), Gesture sensitivity (#586), Customize controls (#692). */}
      <GesturesSheet
        visible={p8Sheet === 'gestures'}
        settings={gestureSettings}
        onSetEnabled={setGesturesEnabled}
        onSetGesture={setGestureOn}
        onSetSensitivity={setGestureSensitivity}
        onReset={resetGestureSettings}
        onClose={closeP8Sheet}
      />
      <GestureSensitivitySheet
        visible={p8Sheet === 'sensitivity'}
        selected={gestureSettings.sensitivity}
        onSelect={onSelectGestureSensitivity}
        onClose={closeP8Sheet}
      />
      <CustomizeControlsSheet
        visible={p8Sheet === 'customize'}
        layout={controlsLayout}
        seekStepSeconds={seekStepSeconds}
        onChange={setControlsLayout}
        onReset={resetControlsLayout}
        onClose={closeP8Sheet}
      />
      {/* P9 #705: the video's bookmarks, and a bookmark's name (adding or renaming). */}
      <VideoBookmarksSheet {...p9.listSheet} />
      <BookmarkNameModal {...p9.nameModal} />
      {/* P10: Video converter, Compress video and the running edit's progress. */}
      <PlayerEditToolsSheets state={p10EditTools.sheets} />
      <PlayerEngineSheets sheets={engine.sheets} />
    </SafeAreaScreen>
  );
});

/** P4: a top subtitle keeps below P2's info box (at 64 dp, up to six rows tall) while it shows. */
const INFO_BOX_CLEARANCE = 64 + 116;

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
