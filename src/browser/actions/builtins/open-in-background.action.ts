import { canOpenInNewTab } from '../open-link-in-new-tab';
import type { BrowserLongPressAction } from '../types';

/** B6 #51: opens the long-pressed link in a new tab behind this one (`context.openInBackground`). */
export const openInBackgroundAction: BrowserLongPressAction = {
  id: 'open_in_background',
  labelKey: 'browserNav.openInBackground',
  icon: 'tab',
  order: 31,
  enabled: true,
  isAvailable: (context) => canOpenInNewTab(context.url) && context.openInBackground != null,
  execute(context) {
    context.openInBackground?.(context.url.trim(), context.linkText);
  },
};
