import { isIncognitoInFront } from '@/browser/incognito/incognito-state';
import { isIncognitoAvailable, openIncognitoTab } from '@/browser/incognito/incognito.service';

import { canOpenInNewTab } from '../open-link-in-new-tab';
import type { BrowserLongPressAction } from '../types';

/** B11 #52: opens the long-pressed link in a new incognito tab (in an incognito tab, "Open in new tab" already does). */
export const openInIncognitoAction: BrowserLongPressAction = {
  id: 'open_in_incognito',
  labelKey: 'browserIncognito.openInIncognito',
  icon: 'incognito',
  order: 35,
  enabled: true,
  isAvailable: (context) => canOpenInNewTab(context.url) && !isIncognitoInFront() && isIncognitoAvailable(),
  execute(context) {
    void openIncognitoTab(context.url.trim());
  },
};
