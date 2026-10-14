import { navigationService } from '@/browser/services';

import type { BrowserLongPressAction } from '../types';

/**
 * Future-ready external browser handoff.
 * Enabled — uses existing navigationService.openExternal.
 */
export const openExternalAction: BrowserLongPressAction = {
  id: 'open_external',
  labelKey: 'browser.linkActions.openExternal',
  icon: 'open-in-new',
  order: 40,
  enabled: true,
  async execute(context) {
    const url = context.url.trim();
    if (!url) {
      return;
    }
    await navigationService.openExternal(url);
  },
};
