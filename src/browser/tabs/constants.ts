/** Phase 3A freeze — hard caps. */
export const MAX_OPEN_TABS = 10 as const;
export const MAX_MOUNTED_WEBVIEWS = 2 as const;

/**
 * Local schema version for the tab persistence envelope. 2 (B1): tabs carry `pinned` and `position`. Readers go by the
 * fields an envelope has, never by this number alone (tab-envelope.ts).
 */
/** 3 (B2): `groups` and each tab's `groupId`. Saves are read by the fields they have, whatever this number says. */
export const BROWSER_TABS_SCHEMA_VERSION = 3 as const;

/** Debounce for coalesced metadata writes (ms). */
export const TAB_PERSIST_DEBOUNCE_MS = 200 as const;
