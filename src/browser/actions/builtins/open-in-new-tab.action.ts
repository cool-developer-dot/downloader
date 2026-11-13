import { canOpenInNewTab } from '../open-link-in-new-tab';
import type { BrowserLongPressAction } from '../types';

/** Opens the long-pressed link in a new tab and switches to it (`context.openInNewTab`, wired by the sheet's hook). */
export const openInNewTabAction: BrowserLongPressAction = {
  id: 'open_in_new_tab',
  labelKey: 'browser.linkActions.openInNewTab',
  icon: 'tab-plus',
  order: 30,
  enabled: true,
  isAvailable: (context) => canOpenInNewTab(context.url),
  execute(context) {
    context.openInNewTab?.(context.url.trim());
  },
};
