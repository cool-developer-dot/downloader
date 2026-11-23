import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DsIcon, DsProgressBar, DsText } from '@/design';
import { useTranslation } from '@/localization';
import { KID_LOCK_HOLD_MS, setKidLock } from '@/player/engine/sleep-limits';

const TICK_MS = 100;

/**
 * P18 #712 Kid Lock: covers the whole Player (the video keeps playing and stays visible), so no touch reaches its
 * controls, sheets or tab bar; Back and the volume keys are held by `useSleepLimits`. Touching and holding the lock
 * for 3 s unlocks it (a progress bar fills; letting go starts again). TalkBack's double tap and hold does the same.
 */
export const KidLockOverlay = memo(function KidLockOverlay({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [heldMs, setHeldMs] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    setHeldMs(0);
  }, []);

  const start = useCallback(() => {
    stop();
    const startedAt = Date.now();
    timer.current = setInterval(() => {
      const held = Date.now() - startedAt;
      if (held >= KID_LOCK_HOLD_MS) {
        stop();
        setKidLock(false);
        AccessibilityInfo.announceForAccessibility(t('playerEngine.kidLockOff'));
        return;
      }
      setHeldMs(held);
    }, TICK_MS);
  }, [stop, t]);

  useEffect(() => stop, [stop]);

  if (!visible) {
    return null;
  }
  return (
    <View style={StyleSheet.absoluteFill} testID="player-kid-lock">
      {/* Swallows every touch on the Player, its sheets and its tab bar. */}
      <Pressable style={StyleSheet.absoluteFill} accessible={false} onPress={() => undefined} />
      <View style={[styles.badgeArea, { paddingBottom: insets.bottom + 28 }]} pointerEvents="box-none">
        <Pressable
          onPressIn={start}
          onPressOut={stop}
          accessibilityRole="button"
          accessibilityLabel={t('playerEngine.kidLockA11y')}
          style={styles.badge}
          testID="player-kid-lock-hold">
          <DsIcon name="lock" size={28} color="#FFFFFF" />
          <DsText variant="bodyStrong" color="#FFFFFF" align="center">
            {t('playerEngine.kidLockOn')}
          </DsText>
          <DsText variant="rowSub" color="rgba(255,255,255,0.8)" align="center">
            {t('playerEngine.kidLockHint')}
          </DsText>
          <View style={styles.progress}>
            <DsProgressBar progress={heldMs / KID_LOCK_HOLD_MS} />
          </View>
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  badgeArea: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  badge: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: 18,
    backgroundColor: 'rgba(16,16,20,0.82)',
    maxWidth: 320,
  },
  progress: {
    alignSelf: 'stretch',
    marginTop: 6,
  },
});
