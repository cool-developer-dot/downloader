/**
 * P15 Headset, keys & remotes on the Player screen: pause on unplug (#560), the media session's ⏭ / ⏮ for the queue
 * (#661 headset, #701 remotes), the Volume keys and a keyboard's / remote's keys (#562, #701), and showing over the
 * lock screen (#703). Called by `usePlayerEngine`.
 */

import type { VideoPlayer } from 'expo-video';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler } from 'react-native';

import { keyCapture } from '@/browser/services/key-capture.service';

import type { AdjustmentHud } from '../adjustment-hud';
import type { PlayerVolumeState } from '../hooks/use-player-volume';
import { useHeadsetKeySettings, type HeadsetKeySettings } from './headset-keys';
import {
  applyPauseWhenAudioBecomesNoisy,
  applyQueueNavigation,
  applyShowWhenLocked,
  readDeviceLocked,
  requestDeviceUnlock,
  subscribeQueueCommands,
} from './native-player';
import { nextVolumeLevel, playerKeyAction, playerKeyCapture, previousTarget, type PlayerKeyAction } from './player-keys';

const KEY_OWNER = 'player.p15';
/** While the Player shows over the lock screen, how often it checks whether the phone is still locked. */
const LOCK_CHECK_MS = 1_500;

export type PlayerKeyHandlers = {
  togglePlay: () => void;
  seekBy: (deltaSeconds: number) => void;
  /** Back to 0:00 (the "previous" of a video's first seconds when there is no previous video). */
  restart: () => void;
  next: (() => void) | null;
  previous: (() => void) | null;
  toggleFullscreen: () => void;
  exitFullscreen: () => void;
  toggleMute: () => void;
};

export type UseHeadsetKeysInput = {
  player: VideoPlayer;
  isReady: boolean;
  positionSeconds: number;
  seekStepSeconds: number;
  isFullscreen: boolean;
  pipActive: boolean;
  /** A sheet is open or the screen is locked: keys keep their normal job. */
  inputBlocked: boolean;
  handlers: PlayerKeyHandlers;
  volume: PlayerVolumeState;
  hud: AdjustmentHud;
  /** Without Android's media volume (an older build), the player's own volume. */
  volumeFallback: { level: number; set: (level: number) => void };
};

export type HeadsetKeys = {
  settings: HeadsetKeySettings;
  /** #703: the Player shows over the lock screen and the phone is locked now. */
  overLockScreen: boolean;
  /** Runs `action` at once, or — over the lock screen — after the phone is unlocked (nothing if it stays locked). */
  whenUnlocked: (action: () => void) => void;
};

export function useHeadsetKeys(input: UseHeadsetKeysInput): HeadsetKeys {
  const settings = useHeadsetKeySettings();
  const { player, isReady } = input;

  // The latest values for listeners that live longer than one render.
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });

  // --- #560 Headphone Detection ----------------------------------------------------------------------------------
  useEffect(() => {
    if (isReady) {
      applyPauseWhenAudioBecomesNoisy(player, settings.pauseOnUnplug);
    }
  }, [isReady, player, settings.pauseOnUnplug]);

  // --- #661 / #701: the media session's ⏭ / ⏮ go to the queue --------------------------------------------------
  const hasNext = input.handlers.next != null;
  const hasPrevious = input.handlers.previous != null;
  useEffect(() => {
    if (isReady) {
      applyQueueNavigation(player, { enabled: settings.headsetButtons, hasNext, hasPrevious });
    }
  }, [hasNext, hasPrevious, isReady, player, settings.headsetButtons]);

  const goNext = useCallback(() => {
    latest.current.handlers.next?.();
  }, []);
  const goPrevious = useCallback(() => {
    const { handlers, positionSeconds } = latest.current;
    if (previousTarget(positionSeconds, handlers.previous != null) === 'previous') {
      handlers.previous?.();
    } else {
      handlers.restart();
    }
  }, []);

  useEffect(
    () =>
      subscribeQueueCommands((command) => {
        if (command === 'next') {
          goNext();
        } else {
          goPrevious();
        }
      }),
    [goNext, goPrevious],
  );

  // --- #562 / #701: Volume keys and a keyboard's, remote's or game pad's keys -----------------------------------
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  const capture = playerKeyCapture(settings, {
    inFront: focused && appActive && !input.pipActive,
    inputBlocked: input.inputBlocked,
  });
  const combosKey = capture.combos.join(' ');
  useEffect(() => {
    keyCapture.setVolumeKeysFor(KEY_OWNER, capture.volumeKeys);
    keyCapture.setCombos(KEY_OWNER, combosKey ? combosKey.split(' ') : []);
  }, [capture.volumeKeys, combosKey]);
  useEffect(
    () => () => {
      keyCapture.setVolumeKeysFor(KEY_OWNER, false);
      keyCapture.setCombos(KEY_OWNER, []);
    },
    [],
  );

  const changeVolume = useCallback((direction: 1 | -1) => {
    const { volume, hud, volumeFallback } = latest.current;
    const level = nextVolumeLevel(volume.available ? volume.level : volumeFallback.level, direction);
    if (volume.available) {
      volume.setLevel(level);
    } else {
      volumeFallback.set(level);
    }
    hud.show('volume', Math.round(level * 100));
    hud.release();
  }, []);

  const run = useCallback(
    (action: PlayerKeyAction) => {
      const { handlers, seekStepSeconds, isFullscreen } = latest.current;
      switch (action) {
        case 'togglePlay':
          handlers.togglePlay();
          break;
        case 'seekBack':
          handlers.seekBy(-seekStepSeconds);
          break;
        case 'seekForward':
          handlers.seekBy(seekStepSeconds);
          break;
        case 'volumeUp':
          changeVolume(1);
          break;
        case 'volumeDown':
          changeVolume(-1);
          break;
        case 'next':
          goNext();
          break;
        case 'previous':
          goPrevious();
          break;
        case 'toggleFullscreen':
          handlers.toggleFullscreen();
          break;
        case 'toggleMute':
          handlers.toggleMute();
          break;
        case 'exitFullscreen':
          if (isFullscreen) {
            handlers.exitFullscreen();
          }
          break;
      }
    },
    [changeVolume, goNext, goPrevious],
  );

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(
    () =>
      keyCapture.subscribe((event) => {
        const action = playerKeyAction(event.key, settingsRef.current);
        // A held key repeats: seeking and the volume follow it, the rest act once.
        if (!action || (event.repeat && !['seekBack', 'seekForward', 'volumeUp', 'volumeDown'].includes(action))) {
          return;
        }
        run(action);
      }, KEY_OWNER),
    [run],
  );

  // --- #703 Show on Lock Screen ------------------------------------------------------------------------------
  const showOverLock = settings.showOnLockScreen && focused && !input.pipActive;
  useEffect(() => {
    applyShowWhenLocked(showOverLock);
    return () => applyShowWhenLocked(false);
  }, [showOverLock]);

  const [deviceLocked, setDeviceLocked] = useState(false);
  useEffect(() => {
    if (!showOverLock) {
      return;
    }
    let cancelled = false;
    const check = () => {
      void readDeviceLocked().then((locked) => {
        if (!cancelled) {
          setDeviceLocked(locked);
        }
      });
    };
    check();
    const timer = setInterval(check, LOCK_CHECK_MS);
    const subscription = AppState.addEventListener('change', check);
    return () => {
      cancelled = true;
      clearInterval(timer);
      subscription.remove();
    };
  }, [showOverLock]);
  const overLockScreen = showOverLock && deviceLocked;

  const whenUnlocked = useCallback(
    (action: () => void) => {
      if (!overLockScreen) {
        action();
        return;
      }
      void requestDeviceUnlock().then((unlocked) => {
        if (unlocked) {
          setDeviceLocked(false);
          action();
        }
      });
    },
    [overLockScreen],
  );

  // Back over the lock screen asks for the unlock and stays on the Player (Back again then leaves it).
  useEffect(() => {
    if (!overLockScreen) {
      return;
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void requestDeviceUnlock().then((unlocked) => {
        if (unlocked) {
          setDeviceLocked(false);
        }
      });
      return true;
    });
    return () => subscription.remove();
  }, [overLockScreen]);

  return { settings, overLockScreen, whenUnlocked };
}
