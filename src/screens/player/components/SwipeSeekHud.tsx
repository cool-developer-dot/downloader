import { memo, useSyncExternalStore } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Text } from '@/components/base/Text';
import { useTranslation } from '@/localization';
import { formatPlaybackTime } from '@/player';
import { formatSeekDelta, formatSwipeSeekLabel, type SwipeSeekHud as SwipeSeekHudStore } from '@/player/swipe-seek';

export type SwipeSeekHudProps = {
  hud: SwipeSeekHudStore;
};

/**
 * P8 #582: where a sideways swipe will take the video, "12:34 (+0:45)", while the finger is down. Subscribes to the
 * swipe's store itself, so a swipe re-renders this pill alone. Never takes a touch. The same fixed dark scrim as the
 * brightness / volume indicator (a media overlay over video pixels, not theme chrome).
 */
export const SwipeSeekHud = memo(function SwipeSeekHud({ hud }: SwipeSeekHudProps) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(hud.subscribe, hud.getSnapshot, hud.getSnapshot);
  if (!state.visible) {
    return null;
  }
  return (
    <Animated.View
      entering={FadeIn.duration(90)}
      exiting={FadeOut.duration(100)}
      pointerEvents="none"
      style={styles.wrap}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={t('videoPlayer.swipeSeekA11y', {
        time: formatPlaybackTime(state.targetSeconds),
        delta: formatSeekDelta(state.deltaSeconds),
      })}
      testID="player-swipe-seek-hud">
      <Animated.View style={styles.card}>
        <Text variant="title" color="white" style={styles.label}>
          {formatSwipeSeekLabel(state)}
        </Text>
      </Animated.View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: '32%',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 6,
  },
  card: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 16,
    alignItems: 'center',
    // Intentional fixed video HUD scrim — readable over arbitrary video frames (as PlayerAdjustmentHud).
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  label: {
    fontVariant: ['tabular-nums'],
  },
});
