import { memo, useEffect } from 'react';
import { View } from 'react-native';

import { requestPasteLink } from '@/browser/services/paste-link-request';
import { useTheme } from '@/hooks/use-theme';
import { navigation, routePaths } from '@/navigation';

/**
 * Quick Add Shortcut (#515), and H22's widget: "Paste link" opens `vidorax://paste-link`, which does exactly what the
 * in-app Paste link button does — that button's own action runs (`paste-link-request.ts`; with Faran's F7 it reads
 * the clipboard and opens the copied link, otherwise it opens the Browser). This route never reads the clipboard.
 */
export const PasteLinkScreen = memo(function PasteLinkScreen() {
  const theme = useTheme();

  useEffect(() => {
    requestPasteLink();
    // Replace (not push) this blank route with the browser, so Back never returns to it.
    navigation.replace(routePaths.browser);
  }, []);

  return <View testID="paste-link-screen" style={{ flex: 1, backgroundColor: theme.colors.background }} />;
});
