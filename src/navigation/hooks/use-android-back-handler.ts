import { useFocusEffect } from 'expo-router';
import { useCallback, useLayoutEffect, useRef } from 'react';

import { BACK_PRIORITY, registerBackOwner } from './back-handler-registry';

type UseAndroidBackHandlerOptions = {
  enabled?: boolean;
  onBackPress: () => boolean;
  /** Explicit position in the Back chain — see BACK_PRIORITY. */
  priority?: number;
};

/**
 * One Back owner per focused screen, ordered by priority rather than by
 * registration time.
 *
 * The handler is read through a ref so a new `onBackPress` identity never
 * re-registers the owner: re-registration used to move the owner to the end of
 * RN's reverse-ordered subscriber list and silently changed which screen
 * consumed Back after a tab switch. The ref follows the latest handler after
 * each commit, before a Back press can reach it.
 */
export function useAndroidBackHandler({
  enabled = true,
  onBackPress,
  priority = BACK_PRIORITY.screen,
}: UseAndroidBackHandlerOptions): void {
  const handlerRef = useRef(onBackPress);
  useLayoutEffect(() => {
    handlerRef.current = onBackPress;
  }, [onBackPress]);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) {
        return undefined;
      }
      return registerBackOwner(priority, () => handlerRef.current());
    }, [enabled, priority]),
  );
}
