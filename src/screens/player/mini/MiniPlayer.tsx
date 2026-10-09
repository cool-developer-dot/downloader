/**
 * The in-app mini player: the one player session (PlayerSessionHost) shown small after the user leaves the full Player.
 * It attaches its own view to the same native player — no second player, no restart, same position — and tapping it
 * brings the full Player back. Hidden next to the full Player and while the system PiP window shows the video.
 */

import { VideoView } from 'expo-video';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { openPlayer } from '@/navigation/helpers/open-player';
import { formatPlaybackTime } from '@/player/format-time';
import {
  closePlayerSession,
  miniPlayerPrimaryAction,
  selectVisibilityInput,
  shouldDismissOnRelease,
  shouldShowMiniPlayer,
  usePlayerSessionHostStore,
  useRedrawOnAttach,
  type LivePlayerSession,
} from '@/player/session-host';

export type MiniPlayerPlacement = 'dock' | 'floating';

export const MINI_PLAYER_HEIGHT = 64;
const PREVIEW_WIDTH = Math.round((MINI_PLAYER_HEIGHT * 16) / 9);

/** Renders the mini player when the session rules allow it (see mini-player-policy), nothing otherwise. */
export const MiniPlayer = memo(function MiniPlayer({ placement }: { placement: MiniPlayerPlacement }) {
  const visible = usePlayerSessionHostStore((s) => shouldShowMiniPlayer(selectVisibilityInput(s)));
  const live = usePlayerSessionHostStore((s) => s.live);
  if (!visible || !live) {
    return null;
  }
  return <MiniPlayerCard key={live.key} live={live} placement={placement} />;
});

/** Whether the mini player is showing now (for layouts that make room for it). */
export function useMiniPlayerVisible(): boolean {
  return usePlayerSessionHostStore((s) => shouldShowMiniPlayer(selectVisibilityInput(s)));
}

const MiniPlayerCard = memo(function MiniPlayerCard({
  live,
  placement,
}: {
  live: LivePlayerSession;
  placement: MiniPlayerPlacement;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { session, controller, player, replay, markFirstFrameRendered, key, requestedMediaId } = live;
  // Took the picture over from the full Player: a paused or finished video must still show its frame here — also
  // when it finishes while shown here.
  useRedrawOnAttach(player, true, session.isCompleted);

  const title = session.displayName ?? t('player.untitled');
  const action = miniPlayerPrimaryAction({
    mediaId: requestedMediaId,
    error: session.error,
    isCompleted: session.isCompleted,
    isPlaying: session.isPlaying,
    isReady: session.isReady,
  });
  const duration = session.durationSeconds;
  const progress = duration != null && duration > 0 ? Math.min(1, Math.max(0, session.positionSeconds / duration)) : 0;
  const subtitle = session.isReady
    ? `${formatPlaybackTime(session.positionSeconds)} / ${formatPlaybackTime(duration)}`
    : t('player.preparing');

  // One tap opens the full Player once (it replaces this card as soon as it mounts).
  const openingRef = useRef(false);
  const onOpen = useCallback(() => {
    if (openingRef.current || !requestedMediaId) {
      return;
    }
    openingRef.current = true;
    setTimeout(() => {
      openingRef.current = false;
    }, 1000);
    openPlayer(requestedMediaId);
  }, [requestedMediaId]);

  const onPrimary = useCallback(() => {
    if (action === 'pause') {
      controller.pause();
    } else if (action === 'play') {
      controller.play();
    } else if (action === 'replay') {
      replay();
    }
  }, [action, controller, replay]);

  const onClose = useCallback(() => {
    closePlayerSession(key);
  }, [key]);

  // Swipe sideways to dismiss (the same as Close).
  const width = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dismissing = useSharedValue(0);
  useEffect(() => {
    dragX.value = 0;
    dismissing.value = 0;
  }, [dismissing, dragX, key]);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Clear horizontal intent only, so taps on the card and its buttons are never claimed.
        .activeOffsetX([-14, 14])
        .failOffsetY([-12, 12])
        /* eslint-disable react-hooks/immutability */
        .onUpdate((event) => {
          'worklet';
          if (dismissing.value) {
            return;
          }
          dragX.value = event.translationX;
        })
        .onEnd((event) => {
          'worklet';
          if (dismissing.value) {
            return;
          }
          if (shouldDismissOnRelease(event.translationX, event.velocityX, width.value)) {
            dismissing.value = 1;
            const direction = event.translationX === 0 ? Math.sign(event.velocityX) || 1 : Math.sign(event.translationX);
            dragX.value = withTiming(
              direction * (width.value + 24),
              { duration: 180, easing: Easing.in(Easing.cubic) },
              (finished) => {
                if (finished) {
                  runOnJS(onClose)();
                }
              },
            );
            return;
          }
          dragX.value = withSpring(0, { damping: 22, stiffness: 260, mass: 0.8 });
        }),
    /* eslint-enable react-hooks/immutability */
    [dismissing, dragX, onClose, width],
  );
  const dragStyle = useAnimatedStyle(() => {
    const w = width.value > 0 ? width.value : 1;
    return {
      transform: [{ translateX: dragX.value }],
      opacity: 1 - Math.min(0.7, Math.abs(dragX.value) / w),
    };
  });

  const floating = placement === 'floating';
  const cardStyle = floating
    ? [
        styles.card,
        styles.floatingCard,
        { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border },
      ]
    : [
        styles.card,
        styles.dockCard,
        { backgroundColor: theme.colors.bottomNavBackground, borderTopColor: theme.colors.bottomNavBorder },
      ];
  const primaryIcon = action === 'pause' ? 'pause' : action === 'replay' ? 'replay' : 'play';
  const primaryLabel =
    action === 'pause' ? t('player.pause') : action === 'replay' ? t('player.replay') : t('player.play');

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        testID="mini-player"
        style={[cardStyle, dragStyle]}
        onLayout={(event) => {
          width.set(event.nativeEvent.layout.width);
        }}>
        <Pressable
          style={styles.body}
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={t('player.mini.openA11y', { title })}
          accessibilityHint={t('player.mini.openHint')}
          testID="mini-player-open">
          <View style={[styles.preview, { backgroundColor: theme.colors.black }]}>
            <VideoView
              player={player}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              nativeControls={false}
              fullscreenOptions={{ enable: false }}
              // Same surface type as the full Player: drawn in the view hierarchy, clipped by the rounded preview.
              surfaceType="textureView"
              allowsPictureInPicture={false}
              startsPictureInPictureAutomatically={false}
              pointerEvents="none"
              onFirstFrameRender={markFirstFrameRendered}
            />
            {session.isSurfaceRevealed ? null : (
              <View style={[StyleSheet.absoluteFill, styles.previewCover, { backgroundColor: theme.colors.black }]}>
                <Icon name="play-circle-outline" size="sm" color="inverse" />
              </View>
            )}
          </View>
          <View style={styles.texts}>
            <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.textPrimary }}>
              {title}
            </Text>
            <Text variant="caption" numberOfLines={1} style={{ color: theme.colors.textSecondary }}>
              {subtitle}
            </Text>
          </View>
        </Pressable>
        <Pressable
          style={styles.button}
          onPress={onPrimary}
          disabled={action === 'none'}
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
          accessibilityState={{ disabled: action === 'none' }}
          hitSlop={4}
          testID="mini-player-play-pause">
          <Icon name={primaryIcon} size="md" color={action === 'none' ? 'disabled' : 'default'} />
        </Pressable>
        <Pressable
          style={styles.button}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('player.mini.close')}
          hitSlop={4}
          testID="mini-player-close">
          <Icon name="close" size="md" color="secondary" />
        </Pressable>
        <View pointerEvents="none" style={[styles.progressTrack, { backgroundColor: theme.colors.border }]}>
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: theme.colors.primary }]} />
        </View>
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  card: {
    height: MINI_PLAYER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  dockCard: {
    borderTopWidth: 1,
  },
  floatingCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  body: {
    flex: 1,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingStart: 8,
  },
  preview: {
    width: PREVIEW_WIDTH,
    height: MINI_PLAYER_HEIGHT - 16,
    borderRadius: 6,
    overflow: 'hidden',
  },
  previewCover: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: {
    flex: 1,
    gap: 2,
  },
  button: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
  },
  progressFill: {
    height: 2,
  },
});
