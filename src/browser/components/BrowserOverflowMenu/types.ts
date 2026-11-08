import type { IconName } from '@/components/base/Icon';

export type BrowserMenuActionId =
  | 'active_downloads'
  | 'recent_downloads'
  | 'grab_links'
  | 'continue_watching'
  | 'recently_watched'
  | 'new_tab'
  | 'reopen_closed_tab'
  | 'duplicate_tab'
  | 'move_to_window'
  | 'profile'
  | 'search_site'
  | 'add_bookmark'
  | 'bookmarks'
  | 'copy_link'
  | 'share'
  | 'translate'
  /** B7 #66 */
  | 'find_in_page'
  /** B9 #89 */
  | 'reading_list_add'
  /** B15 #161 */
  | 'reader_mode'
  /** B16 */
  | 'page_display'
  | 'hard_reload'
  | 'scroll_top'
  | 'scroll_bottom'
  | 'auto_scroll'
  | 'history'
  | 'desktop_site'
  | 'open_external'
  | 'downloads'
  | 'settings'
  /** B10 #99: shown while "Clear history on exit" is on. */
  | 'exit';

export type BrowserMenuItemKind = 'action' | 'toggle';

export type BrowserMenuItemModel = {
  id: BrowserMenuActionId;
  icon: IconName;
  label: string;
  accessibilityLabel: string;
  kind: BrowserMenuItemKind;
  enabled: boolean;
  /** Toggle row only — current on/off state. */
  toggled?: boolean;
  showDividerBefore?: boolean;
};

export type BrowserOverflowAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserMenuFeedback = {
  message: string;
  tone?: 'success' | 'neutral';
};
