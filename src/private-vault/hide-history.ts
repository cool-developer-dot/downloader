/**
 * Hide History (#460). Pure. A video moved to Private must not appear anywhere outside the vault: not in Downloads,
 * Player lists, Continue Watching, Watch History, Favorites, search, data exports or debug logs.
 *
 * Most of that follows from the model: the vault is its own store with its own random ids (no library or download
 * id, page or site is kept), and the original is removed through the app's delete path, which drops the library row
 * (with its favourite flag and search entry), the download record, the downloads-store entry, the export receipt and
 * the notifications. What that path leaves is the stored playback position, which Watch History and Continue
 * Watching read: the plan below names it so the move removes it too. Playing from the vault records nothing.
 */

export type StoredPlaybackKey = { namespace: string; mediaId: string };

export type HideHistoryPlan = {
  /** Stored playback positions (Watch History, Continue Watching, resume) to delete. */
  playback: StoredPlaybackKey[];
  /** Refresh the history and Continue Watching lists afterwards. */
  refreshPlaybackLists: boolean;
};

/** Pure: what the move must forget about library item `mediaId` once the original is deleted. */
export function hideHistoryPlan(mediaId: string, namespaces: readonly string[]): HideHistoryPlan {
  if (!mediaId) {
    return { playback: [], refreshPlaybackLists: false };
  }
  const unique = [...new Set(namespaces.filter((namespace) => namespace.length > 0))];
  return {
    playback: unique.map((namespace) => ({ namespace, mediaId })),
    refreshPlaybackLists: unique.length > 0,
  };
}

/**
 * Pure: of stored playback keys (`<prefix>:<namespace>:<mediaId>`), the ones that name `mediaId` — in any namespace,
 * and never a different video whose id merely starts or ends the same way.
 */
export function playbackKeysFor(keys: readonly string[], mediaId: string, prefix: string): StoredPlaybackKey[] {
  const head = `${prefix}:`;
  const out: StoredPlaybackKey[] = [];
  for (const key of keys) {
    if (!key.startsWith(head)) {
      continue;
    }
    const rest = key.slice(head.length);
    const colon = rest.indexOf(':');
    if (colon <= 0) {
      continue;
    }
    if (rest.slice(colon + 1) === mediaId) {
      out.push({ namespace: rest.slice(0, colon), mediaId });
    }
  }
  return out;
}
