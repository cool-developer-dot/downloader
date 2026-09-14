import * as Clipboard from 'expo-clipboard';

import type { BrowserLongPressAction } from '../types';

export const copyLinkAction: BrowserLongPressAction = {
  id: 'copy_link',
  label: 'Copy Link',
  icon: 'content-copy',
  order: 10,
  enabled: true,
  async execute(context) {
    const url = context.url.trim();
    if (!url) {
      return;
    }
    await Clipboard.setStringAsync(url);
  },
};
