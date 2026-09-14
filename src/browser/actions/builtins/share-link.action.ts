import { Share } from 'react-native';

import type { BrowserLongPressAction } from '../types';

export const shareLinkAction: BrowserLongPressAction = {
  id: 'share_link',
  label: 'Share Link',
  icon: 'share-variant',
  order: 20,
  enabled: true,
  async execute(context) {
    const url = context.url.trim();
    if (!url) {
      return;
    }

    try {
      await Share.share({
        message: context.linkText ? `${context.linkText}\n${url}` : url,
        url,
        title: context.title || context.linkText || 'Share link',
      });
    } catch {
      // User dismissal / platform cancel — ignore.
    }
  },
};
