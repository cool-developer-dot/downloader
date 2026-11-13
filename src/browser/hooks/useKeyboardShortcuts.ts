import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { keyCapture } from '@/browser/services/key-capture.service';
import { browserCommands } from '@/browser/startup/browser-commands';
import { escapePanels } from '@/browser/startup/escape-panels';
import { findInPage } from '@/browser/find/find-in-page.service';
import { shortcutActionFor, shortcutCombos, type ShortcutAction } from '@/browser/startup/keyboard-shortcuts';

const OWNER = 'b21-shortcuts';

function run(action: ShortcutAction): void {
  switch (action) {
    case 'newTab':
      return browserCommands.newTab();
    case 'closeTab':
      return browserCommands.closeTab();
    case 'reopenTab':
      return browserCommands.reopenTab();
    case 'nextTab':
      return browserCommands.switchTab(1);
    case 'previousTab':
      return browserCommands.switchTab(-1);
    case 'focusAddressBar':
      return browserCommands.focusAddressBar();
    case 'reload':
      return browserCommands.reload();
    case 'hardReload':
      return browserCommands.hardReload();
    case 'back':
      return browserCommands.back();
    case 'forward':
      return browserCommands.forward();
    case 'bookmark':
      return void browserCommands.bookmarkPage();
    case 'history':
      return browserCommands.history();
    case 'findInPage':
      findInPage.open();
      return;
    case 'closePanel':
      escapePanels.closeNewest();
      return;
  }
}

/**
 * B21 #246 — keyboard shortcuts while the Browser tab is in front and the app is in the foreground (B6's key channel
 * takes only these combos, and only then). Held keys repeat only tab switching.
 */
export function useKeyboardShortcuts(): void {
  const [focused, setFocused] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const panelOpen = useSyncExternalStore(escapePanels.subscribe, escapePanels.isAnyOpen, escapePanels.isAnyOpen);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    const app = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => app.remove();
  }, []);

  const browserInFront = focused && appActive;

  useEffect(() => {
    keyCapture.setCombos(OWNER, shortcutCombos({ browserInFront, panelOpen }));
  }, [browserInFront, panelOpen]);

  useEffect(() => {
    const unsubscribe = keyCapture.subscribe((event) => {
      const action = shortcutActionFor(event.key);
      if (!action) return;
      if (event.repeat && action !== 'nextTab' && action !== 'previousTab') return;
      run(action);
    });
    return () => {
      unsubscribe();
      keyCapture.setCombos(OWNER, []);
    };
  }, []);
}
