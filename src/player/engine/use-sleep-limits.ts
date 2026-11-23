/**
 * P18 Sleep timer & limits on the Player screen: the shared countdown (#644 / #730, armed natively while a video
 * plays), counting today's watching (#730), and Kid Lock's Back and keys (#712). Called by `usePlayerEngine`.
 */

import type { VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, BackHandler } from 'react-native';

import { keyCapture } from '@/browser/services/key-capture.service';

import { applyPlaybackDeadline, subscribePlaybackDeadline } from './native-player';
import {
  cancelSleepTimer,
  countdownStart,
  getLimitState,
  getSleepTimer,
  hideLimitNotice,
  limitSecondsLeft,
  localDay,
  nextDeadline,
  recordWatched,
  shouldRearm,
  showLimitNotice,
  useKidLock,
  useLimitNotice,
  useLimitState,
  useSleepTimer,
} from './sleep-limits';

/** While a video plays, today's watching is saved this often (and when it stops). */
const COUNT_EVERY_MS = 5_000;
const KID_LOCK_KEYS = 'player.p18.kidLock';

export type SleepLimits = {
  /** #730: today's limit is used up (the video can't play until tomorrow, or more time). */
  limitReached: boolean;
  /** The "Daily limit reached" sheet. */
  limitSheetVisible: boolean;
  closeLimitSheet: () => void;
  /** #712: Kid Lock is on. */
  kidLock: boolean;
};

export function useSleepLimits(input: {
  player: VideoPlayer;
  isReady: boolean;
  isPlaying: boolean;
  isCompleted: boolean;
  /** Pause through the session (so its state follows). */
  pause: () => void;
  announce: (message: 'sleep' | 'limit') => void;
}): SleepLimits {
  const { player, isReady, isPlaying, isCompleted, pause, announce } = input;
  const timer = useSleepTimer();
  const limit = useLimitState();
  const kidLock = useKidLock();

  // --- #730: count today's watching while a video plays ----------------------------------------------------------
  const lastTick = useRef<number | null>(null);
  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    lastTick.current = Date.now();
    const flush = () => {
      const now = Date.now();
      if (lastTick.current != null) {
        recordWatched((now - lastTick.current) / 1000, new Date(now));
      }
      lastTick.current = now;
    };
    const interval = setInterval(flush, COUNT_EVERY_MS);
    // Coming back from the background, count the time the screen was off too (timers may have waited).
    const subscription = AppState.addEventListener('change', flush);
    return () => {
      clearInterval(interval);
      subscription.remove();
      flush();
      lastTick.current = null;
    };
  }, [isPlaying]);

  const today = localDay(new Date());
  const left = limitSecondsLeft(limit, today);
  const limitReached = left != null && left <= 0;
  const limitSheetVisible = useLimitNotice();

  // A video started at the limit pauses at once and says why.
  useEffect(() => {
    if (isPlaying && limitReached) {
      pause();
      showLimitNotice();
      announce('limit');
    }
  }, [announce, isPlaying, limitReached, pause]);

  // --- #644 / #730: the shared countdown, armed natively while the video plays ------------------------------------
  // Set again only when its end moves (a new timer, another limit, more time) — not on each count of today's watching,
  // which would restart a fade under way.
  const armed = useRef<{ endsAt: number; reason: 'sleep' | 'limit' } | null>(null);
  const leftSeconds = left == null ? null : Math.round(left);
  useEffect(() => {
    if (!isReady) {
      return;
    }
    const now = Date.now();
    const plan = isPlaying ? nextDeadline({ timer, limitSecondsLeft: leftSeconds, now }) : null;
    const next = plan ? { endsAt: now + plan.inMs, reason: plan.reason } : null;
    if (!shouldRearm(armed.current, next)) {
      return;
    }
    armed.current = next;
    if (!plan) {
      applyPlaybackDeadline(player, null, 0);
      return;
    }
    const { inMs, fadeMs } = countdownStart(plan.inMs);
    applyPlaybackDeadline(player, inMs, fadeMs);
  }, [isPlaying, isReady, leftSeconds, player, timer]);
  useEffect(
    () => () => {
      armed.current = null;
      applyPlaybackDeadline(player, null, 0);
    },
    [player],
  );

  useEffect(
    () =>
      subscribePlaybackDeadline(() => {
        const reason = armed.current?.reason ?? (getSleepTimer().mode === 'minutes' ? 'sleep' : 'limit');
        armed.current = null;
        if (reason === 'sleep') {
          cancelSleepTimer();
          announce('sleep');
        } else {
          const state = getLimitState();
          recordWatched(Math.max(0, state.dailyMinutes * 60 - state.usedSeconds));
          showLimitNotice();
          announce('limit');
        }
      }),
    [announce],
  );

  // #644 "End of this video": P5's end of playback stops the video (`isSleepAtEndOfVideo`); then the timer is done.
  useEffect(() => {
    if (isCompleted && timer.mode === 'endOfVideo') {
      cancelSleepTimer();
      announce('sleep');
    }
  }, [announce, isCompleted, timer.mode]);

  // --- #712 Kid Lock: Back and the volume keys do nothing (touches: the overlay) --------------------------------
  useEffect(() => {
    if (!kidLock) {
      return;
    }
    const back = BackHandler.addEventListener('hardwareBackPress', () => true);
    keyCapture.setVolumeKeysFor(KID_LOCK_KEYS, true);
    const keys = keyCapture.subscribe(() => undefined, KID_LOCK_KEYS);
    return () => {
      back.remove();
      keys();
      keyCapture.setVolumeKeysFor(KID_LOCK_KEYS, false);
    };
  }, [kidLock]);

  const closeLimitSheet = useCallback(() => hideLimitNotice(), []);

  return { limitReached, limitSheetVisible, closeLimitSheet, kidLock };
}
