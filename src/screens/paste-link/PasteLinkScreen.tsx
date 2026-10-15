import * as Clipboard from 'expo-clipboard';
import { memo, useEffect } from 'react';
import { AppState, View } from 'react-native';

import { urlFromSharedText } from '@/browser/services/incoming-link';
import { openLinkLikePaste } from '@/browser/services/open-link-like-paste';
import { useTheme } from '@/hooks/use-theme';
import { navigation, routePaths } from '@/navigation';

/** Android lets only the focused app read the clipboard: give the window a moment to take focus. */
const READ_DELAY_MS = 400;

async function readClipboardText(): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, READ_DELAY_MS));
    if (AppState.currentState !== 'active') {
      return null;
    }
    try {
      const text = await Clipboard.getStringAsync();
      if (text?.trim()) {
        return text;
      }
    } catch {
      // try once more after focus settles
    }
  }
  return null;
}

/**
 * Quick Add Shortcut (#515): the app shortcut "Paste link" opens `vidorax://paste-link`. While VidoraX is in front
 * the clipboard is read once; a link in it opens through the pasted-link path (YouTube refused, private hosts never
 * opened), otherwise the browser simply opens — the same place the existing Paste link button goes.
 */
export const PasteLinkScreen = memo(function PasteLinkScreen() {
  const theme = useTheme();

  useEffect(() => {
    let cancelled = false;
    void readClipboardText().then((text) => {
      if (cancelled) {
        return;
      }
      const url = urlFromSharedText(text);
      const outcome = openLinkLikePaste(url);
      if (outcome !== 'opened') {
        navigation.replace(routePaths.browser);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <View testID="paste-link-screen" style={{ flex: 1, backgroundColor: theme.colors.background }} />;
});
