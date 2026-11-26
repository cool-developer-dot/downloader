export const DATABASE_NAME = 'vidorax.db';

/**
 * v1: browser history/bookmarks. v2: local download catalog + folders + url favorites.
 * v3 (B9): bookmark folders, tags, notes and order, and the reading list (`applyBrowserTables` → bookmark-organizer-schema).
 * v4 (B14): site blocker and focus lists, daily time limits and time used, the focus timer (`applyBrowserTables` →
 * site-blocking-schema; new tables only).
 * v5 (B22): notes (`applyBrowserTables` → notes-schema; a new table only).
 * v6 (B19): user scripts (`applyBrowserTables` → user-scripts-schema; a new table only).
 * v7 (B23): highlights and watched pages (`applyBrowserTables` → annotate-schema; new tables only).
 * v8 (B17): saved (offline) pages (`applyBrowserTables` → saved-pages-schema; a new table only).
 * v9 (P7): playlists and their videos (`applyPlaylistTables` → playlist-schema; new tables only, app database only —
 * not part of `applyBrowserTables`, so browser-profile databases never get them).
 * v10 (P9): play counts and video bookmarks (`applyLibraryStatsTables` → library-stats-schema; new tables only, app
 * database only, like v9).
 */
export const DATABASE_VERSION = 11;

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
  // B22 (Hamza)
  notes: 'notes',
  // B19 (Hamza)
  userScripts: 'user_scripts',
  // B23 (Hamza)
  highlights: 'highlights',
  pageWatches: 'page_watches',
  // B17 (Hamza)
  savedPages: 'saved_pages',
  // P7 (Hamza)
  playlists: 'playlists',
  playlistItems: 'playlist_items',
  // P9 (Hamza): `bookmarks` is the browser's, so video bookmarks have their own name.
  mediaPlayStats: 'media_play_stats',
  videoBookmarks: 'video_bookmarks',
} as const;

export const RECENT_SEARCH_LIMIT = 50;

export const RECENT_URL_LIMIT = 50;

export type TableName = (typeof TABLE_NAMES)[keyof typeof TABLE_NAMES];
