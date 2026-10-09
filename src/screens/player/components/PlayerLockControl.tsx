import { memo, useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { useTranslation } from '@/localization';

/** How long the unlock pill stays up after a tap on a locked screen. */
const UNLOCK_HINT_MS = 2500;

/** Where the lock sits on the video: its top start corner, just under the top bar. */
const LOCK_TOP = 64;

/** The lock button shown with the other controls (unlocked). */
export const PlayerLockButton = memo(function PlayerLockButton({ onLock }: { onLock: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onLock}
      accessibilityRole="button"
      accessibilityLabel={t('player.lockScreen')}
      hitSlop={8}
      testID="player-lock"
      style={({ pressed }) => [styles.lockButton, pressed ? styles.pressed : null]}>
      <Icon name="lock-open-variant-outline" size="md" color="inverse" />
    </Pressable>
  );
});

/**
 * The locked screen: swallows every touch on the video (no seek, zoom, volume or brightness gestures and no
 * controls). A tap shows the unlock pill in the same corner for a moment; tapping the pill unlocks.
 */
export const PlayerLockedOverlay = memo(function PlayerLockedOverlay({ onUnlock }: { onUnlock: () => void }) {
  const { t } = useTranslation();
  const [hintVisible, setHintVisible] = useState(true);

  useEffect(() => {
    if (!hintVisible) {
      return;
    }
    const timer = setTimeout(() => setHintVisible(false), UNLOCK_HINT_MS);
    return () => clearTimeout(timer);
  }, [hintVisible]);

  const showHint = useCallback(() => setHintVisible(true), []);

  return (
    <Pressable
      style={styles.lockedOverlay}
      onPress={showHint}
      accessibilityLabel={t('player.screenLocked')}
      testID="player-locked-overlay">
      {hintVisible ? (
        <View style={styles.lockedCorner}>
          <Pressable
            onPress={onUnlock}
            accessibilityRole="button"
            accessibilityLabel={t('player.unlockScreen')}
            hitSlop={8}
            testID="player-unlock"
            style={({ pressed }) => [styles.lockedPill, pressed ? styles.pressed : null]}>
            <Icon name="lock" size="md" color="inverse" />
            <Text variant="caption" color="white" numberOfLines={1}>
              {t('player.screenLocked')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  lockButton: {
    position: 'absolute',
    top: LOCK_TOP,
    start: 12,
    zIndex: 4,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  lockedOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 10,
  },
  lockedCorner: {
    position: 'absolute',
    top: LOCK_TOP,
    start: 12,
  },
  lockedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  pressed: {
    opacity: 0.7,
  },
});
