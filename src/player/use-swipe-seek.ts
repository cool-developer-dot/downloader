import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { GestureSensitivity } from './gesture-settings';
import { createSwipeSeekHud, swipeSeekTarget, type SwipeSeekHud, type SwipeSeekTarget } from './swipe-seek';

type UseSwipeSeekOptions = {
  durationSeconds: number | null;
  sensitivity: GestureSensitivity;
  /** Where the video is now, from the player's own clock (the session's position lags). */
  readPositionSeconds: () => number;
  /** The seek, when the finger lifts. */
  seekTo: (seconds: number) => void;
  /** The swipe was recognised (another gesture's indicator should go). */
  onBegin?: () => void;
};

export type SwipeSeekGesture = {
  /** The indicator's store — read by `SwipeSeekHud` alone, so a swipe never re-renders the screen. */
  hud: SwipeSeekHud;
  /** The sideways swipe was recognised. */
  onStart: () => void;
  onUpdate: (translationX: number, surfaceWidth: number) => void;
  /** Every touch the recogniser saw ends here; `success` only when the finger lifted after a recognised swipe. */
  onFinalize: (success: boolean) => void;
};

/**
 * P8 #582 Horizontal Swipe Seek: follows the finger in the indicator and seeks once, when the finger lifts. A swipe
 * that is cancelled (a second finger, a lock, a sheet opening) seeks nowhere. Callbacks are stable for the life of the
 * screen, so the gesture recognisers are not rebuilt while a video plays.
 */
export function useSwipeSeek(options: UseSwipeSeekOptions): SwipeSeekGesture {
  const [hud] = useState(() => createSwipeSeekHud());
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const activeRef = useRef(false);
  const startRef = useRef(0);
  const targetRef = useRef<SwipeSeekTarget | null>(null);

  useEffect(() => () => hud.dispose(), [hud]);

  const onStart = useCallback(() => {
    const { durationSeconds, readPositionSeconds, onBegin } = optionsRef.current;
    const start = readPositionSeconds();
    const first = swipeSeekTarget({ startSeconds: start, durationSeconds, translationX: 0, surfaceWidth: 1 });
    if (!first) {
      return;
    }
    activeRef.current = true;
    startRef.current = first.targetSeconds;
    targetRef.current = first;
    onBegin?.();
    hud.show(first);
  }, [hud]);

  const onUpdate = useCallback(
    (translationX: number, surfaceWidth: number) => {
      if (!activeRef.current) {
        return;
      }
      const { durationSeconds, sensitivity } = optionsRef.current;
      const target = swipeSeekTarget({
        startSeconds: startRef.current,
        durationSeconds,
        translationX,
        surfaceWidth,
        sensitivity,
      });
      if (!target) {
        return;
      }
      targetRef.current = target;
      hud.show(target);
    },
    [hud],
  );

  const onFinalize = useCallback(
    (success: boolean) => {
      const target = targetRef.current;
      const wasActive = activeRef.current;
      activeRef.current = false;
      targetRef.current = null;
      hud.hide();
      if (!wasActive || !success || !target || target.deltaSeconds === 0) {
        return;
      }
      optionsRef.current.seekTo(target.targetSeconds);
    },
    [hud],
  );

  return { hud, onStart, onUpdate, onFinalize };
}
