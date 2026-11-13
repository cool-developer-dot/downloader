import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Keyboard } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { pageActivity } from '@/browser/scroll/page-activity';
import { scrollActivePageStep } from '@/browser/scroll/page-scroll.service';
import { shouldCaptureVolumeKeys, volumeKeyDirection } from '@/browser/scroll/volume-keys';
import { keyCapture } from '@/browser/services/key-capture.service';
import { useBrowserStore } from '@/browser/stores';
import { isBrowserHomeUrl } from '@/browser/utils';
import { usePlayerSessionHostStore } from '@/player/session-host/player-session-store';
import { useSettingsStore } from '@/store/settings';

/**
 * B6 #240: while the setting is on and a web page is in front (Browser tab focused, app in the foreground, no
 * keyboard, nothing covering the page, no audible media in the page or the app's player), Volume Down / Up scroll the
 * page one step instead of changing the volume. Every other moment the keys keep their normal job.
 */
export function useVolumeKeyScroll({ overlayOpen }: { overlayOpen: boolean }): void {
  const enabled = useSettingsStore((state) => state.volumeKeyScroll === true);
  const currentUrl = useBrowserStore((state) => state.currentUrl);
  const activeTabId = useBrowserStore((state) => state.activeTabId);
  const playerPlaying = usePlayerSessionHostStore((state) => state.live?.session.isPlaying === true);
  const pageMediaPlaying = useSyncExternalStore(pageActivity.subscribe, () => pageActivity.isMediaPlaying(activeTabId));
  const [focused, setFocused] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [keyboardUp, setKeyboardUp] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    const app = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => {
      app.remove();
      show.remove();
      hide.remove();
    };
  }, []);

  const capture = shouldCaptureVolumeKeys({
    enabled,
    browserInFront: focused && appActive,
    pageShown: !isBrowserHomeUrl(currentUrl) && !overlayOpen,
    keyboardUp,
    pageMediaPlaying,
    playerPlaying,
  });

  useEffect(() => {
    keyCapture.setVolumeKeys(capture);
  }, [capture]);

  useEffect(() => {
    const unsubscribe = keyCapture.subscribe((event) => {
      const direction = volumeKeyDirection(event.key);
      if (direction !== 0) scrollActivePageStep(direction);
    });
    return () => {
      unsubscribe();
      keyCapture.setVolumeKeys(false);
    };
  }, []);
}
