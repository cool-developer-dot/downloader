import type { VideoThumbnail } from 'expo-video';
import { memo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { DsIcon, DsText } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { PlayerTimeline } from '../components/PlayerTimeline';

export type PlayerCardOverlayProps = {
  title: string;
  /** The artist VidoraX keeps for the item, when there is one. */
  artist?: string | null;
  /** "1080p", when the track size is known. */
  quality: string | null;
  isPlaying: boolean;
  isReady: boolean;
  isLoading: boolean;
  isCompleted: boolean;
  disabled: boolean;
  onBack: () => void;
  onOpenOptions: () => void;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  onPlayPause: () => void;
  onReplay: () => void;
  positionSeconds: number;
  durationSeconds: number | null;
  previewSeconds: number | null;
  previewFrame: VideoThumbnail | null;
  onSeekStart: (seconds: number) => void;
  onSeekChange: (seconds: number) => void;
  onSeekCommit: () => void;
  onSeekCancel: () => void;
  /** P5 #541: the A-B repeat points on the bar, and its clear button. */
  loopMarkers?: { a: number | null; b: number | null } | null;
  onClearLoop?: () => void;
};

/** Icon sizes measured on screen 19: 22.6 dp tall solid ⏮ ⏸ ⏭, 2.7 dp strokes, 51 dp apart. */
const TRANSPORT_ICON = 24;
const TRANSPORT_STROKE = 2.6;

/**
 * The controls drawn on the video card of screen 19: "← Episode 1 · 1080p ⋮" along the top, ⏮ ⏸ ⏭ above the middle,
 * and a 6 dp white bar with the time played and the time left at the bottom. Over the picture, so always white.
 */
export const PlayerCardOverlay = memo(function PlayerCardOverlay({
  title,
  artist,
  quality,
  isPlaying,
  isReady,
  isLoading,
  isCompleted,
  disabled,
  onBack,
  onOpenOptions,
  onPrevious,
  onNext,
  onPlayPause,
  onReplay,
  positionSeconds,
  durationSeconds,
  previewSeconds,
  previewFrame,
  onSeekStart,
  onSeekChange,
  onSeekCommit,
  onSeekCancel,
  loopMarkers = null,
  onClearLoop,
}: PlayerCardOverlayProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const white = theme.colors.white;
  const controlsDisabled = disabled || (!isReady && !isCompleted) || isLoading;
  const subtitle = [artist, quality].filter(Boolean).join(' · ');

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="player-card-overlay">
      <View style={styles.scrim} pointerEvents="none" />

      <View style={[styles.topRow, { flexDirection: rtl.rowDirection }]} pointerEvents="box-none">
        <Pressable
          onPress={onBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('player.goBack')}
          style={styles.cornerButton}
          testID="player-card-back">
          <DsIcon name={rtl.arrowBack} size={17} color={white} strokeWidth={2} />
        </Pressable>
        <View style={[styles.titleRow, { flexDirection: rtl.rowDirection }]}>
          <DsText variant="body" color={white} numberOfLines={1} style={styles.title}>
            {title}
          </DsText>
          {subtitle ? (
            <DsText variant="body" color={white} numberOfLines={1}>
              {` · ${subtitle}`}
            </DsText>
          ) : null}
        </View>
        <Pressable
          onPress={onOpenOptions}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('videoPlayer.moreOptions')}
          accessibilityHint={t('videoPlayer.moreOptionsSectionsHint')}
          style={styles.cornerButton}
          testID="player-card-options">
          <DsIcon name="ellipsis-vertical" size={17} color={white} strokeWidth={2} />
        </Pressable>
      </View>

      {/* Physical order, never mirrored: previous is always on the left, like the timeline. */}
      <View style={styles.transport} pointerEvents="box-none">
        <Pressable
          onPress={onPrevious ?? undefined}
          disabled={!onPrevious}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={t('player.previousVideo')}
          accessibilityState={{ disabled: !onPrevious }}
          style={styles.transportButton}
          testID="player-card-previous">
          <DsIcon name="skip-back" size={TRANSPORT_ICON} color={white} fill={white} strokeWidth={TRANSPORT_STROKE} />
        </Pressable>
        <View style={styles.transportButton}>
          {isLoading ? (
            <ActivityIndicator color={white} accessibilityLabel={t('player.preparing')} />
          ) : isCompleted ? (
            <Pressable
              onPress={onReplay}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={t('player.replay')}
              style={styles.transportButton}
              testID="player-card-replay">
              <DsIcon name="rotate-cw" size={TRANSPORT_ICON} color={white} strokeWidth={TRANSPORT_STROKE} />
            </Pressable>
          ) : (
            <Pressable
              onPress={onPlayPause}
              disabled={controlsDisabled && !isReady}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={isPlaying ? t('player.pause') : t('player.play')}
              style={styles.transportButton}
              testID="player-card-play-pause">
              <DsIcon
                name={isPlaying ? 'pause' : 'play'}
                size={TRANSPORT_ICON}
                color={white}
                fill={white}
                strokeWidth={TRANSPORT_STROKE}
              />
            </Pressable>
          )}
        </View>
        <Pressable
          onPress={onNext ?? undefined}
          disabled={!onNext}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={t('player.nextVideo')}
          accessibilityState={{ disabled: !onNext }}
          style={styles.transportButton}
          testID="player-card-next">
          <DsIcon name="skip-forward" size={TRANSPORT_ICON} color={white} fill={white} strokeWidth={TRANSPORT_STROKE} />
        </Pressable>
      </View>

      <View style={styles.timeline} pointerEvents="box-none">
        <PlayerTimeline
          variant="card"
          positionSeconds={positionSeconds}
          durationSeconds={durationSeconds}
          previewSeconds={previewSeconds}
          previewFrame={previewFrame}
          disabled={disabled || !isReady}
          onSeekStart={onSeekStart}
          onSeekChange={onSeekChange}
          onSeekCommit={onSeekCommit}
          onSeekCancel={onSeekCancel}
          loopMarkers={loopMarkers}
          onClearLoop={onClearLoop}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  // Screen 19: the arrow 13.7 dp in, the line's middle 18.5 dp down; ⋮ 18 dp from the end.
  topRow: {
    position: 'absolute',
    top: 2,
    start: 4,
    end: 2,
    height: 34,
    alignItems: 'center',
  },
  cornerButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  title: {
    flexShrink: 1,
  },
  // ⏮ ⏸ ⏭ centred 51 dp apart, their middle 74 dp below the top of the 169 dp card (44 %; a taller card keeps the share).
  transport: {
    position: 'absolute',
    top: '44%',
    marginTop: -22,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7,
  },
  transportButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The bar 10.7 dp in from each side, the times under it, 9 dp from the bottom edge (its touch area reaches up).
  timeline: {
    position: 'absolute',
    left: 10.7,
    right: 10.7,
    bottom: 9,
  },
});
