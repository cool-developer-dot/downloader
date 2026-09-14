export const DATABASE_NAME = 'vidorax.db';

/** v1: browser history/bookmarks. v2: local download catalog + folders + url favorites. */
export const DATABASE_VERSION = 2;

export const TABLE_NAMES = {
  browserHistory: 'browser_history',
  bookmarks: 'bookmarks',
  recentSearches: 'recent_searches',
  recentUrls: 'recent_urls',
  downloadsCatalog: 'downloads_catalog',
  mediaFolders: 'media_folders',
  urlFavorites: 'url_favorites',
} as const;

export const RECENT_SEARCH_LIMIT = 50;

export const RECENT_URL_LIMIT = 50;

export type TableName = (typeof TABLE_NAMES)[keyof typeof TABLE_NAMES];
