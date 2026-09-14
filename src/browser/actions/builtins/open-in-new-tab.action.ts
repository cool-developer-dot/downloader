import type { BrowserLongPressAction } from '../types';

/**
 * Architecture-only placeholder for multi-tab.
 * Visible but disabled until the Tabs phase registers a real executor.
 */
export const openInNewTabAction: BrowserLongPressAction = {
  id: 'open_in_new_tab',
  label: 'Open in New Tab',
  icon: 'tab-plus',
  order: 30,
  enabled: false,
  execute(context) {
    context.openInNewTab?.(context.url);
  },
};
