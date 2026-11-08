export const DATABASE_NAME = 'vidorax.db';

/**
 * v1: browser history/bookmarks. v2: local download catalog + folders + url favorites.
 * v3 (B9): bookmark folders, tags, notes and order, and the reading list (`applyBrowserTables` → bookmark-organizer-schema).
 * v4 (B14): site blocker and focus lists, daily time limits and time used, the focus timer (`applyBrowserTables` →
 * site-blocking-schema; new tables only).
 */
export const DATABASE_VERSION = 4;

export const TABLE_NAMES = {
  browserHistory: 'browser_history',
  bookmarks: 'bookmarks',
  recentSearches: 'recent_searches',
  recentUrls: 'recent_urls',
  downloadsCatalog: 'downloads_catalog',
  mediaFolders: 'media_folders',
  urlFavorites: 'url_favorites',
  // B9 (Hamza)
  bookmarkFolders: 'bookmark_folders',
  bookmarkTags: 'bookmark_tags',
  readingList: 'reading_list',
  // B14 (Hamza)
  siteBlockLists: 'site_block_lists',
  siteTimeLimits: 'site_time_limits',
  siteTimeUsage: 'site_time_usage',
  focusSession: 'focus_session',
} as const;

export const RECENT_SEARCH_LIMIT = 50;

export const RECENT_URL_LIMIT = 50;

export type TableName = (typeof TABLE_NAMES)[keyof typeof TABLE_NAMES];
