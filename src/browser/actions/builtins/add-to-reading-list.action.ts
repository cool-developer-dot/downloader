import { addPageToReadingList } from '@/browser/bookmarks/bookmarks.service';

import { canOpenInNewTab } from '../open-link-in-new-tab';
import type { BrowserLongPressAction } from '../types';

/** B9 #89: puts the long-pressed link on the reading list (unread), titled by the link's text. */
export const addToReadingListAction: BrowserLongPressAction = {
  id: 'add_to_reading_list',
  labelKey: 'browserBookmarks.readingAdd',
  icon: 'book-open-variant',
  order: 33,
  enabled: true,
  isAvailable: (context) => canOpenInNewTab(context.url),
  execute(context) {
    const url = context.url.trim();
    void addPageToReadingList(url, context.linkText?.trim() || url);
  },
};
