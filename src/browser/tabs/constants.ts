/** Phase 3A freeze — hard caps. */
export const MAX_OPEN_TABS = 8 as const;
export const MAX_MOUNTED_WEBVIEWS = 2 as const;

/** Local schema version for tab persistence envelope. */
export const BROWSER_TABS_SCHEMA_VERSION = 1 as const;

/** Debounce for coalesced metadata writes (ms). */
export const TAB_PERSIST_DEBOUNCE_MS = 200 as const;
