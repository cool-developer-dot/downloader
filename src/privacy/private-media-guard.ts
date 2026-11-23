/**
 * P11 #686 — the library ids moved to Private in this run, in memory only. Pure (no storage, no native code), so the
 * playback event contract (`src/player/playback-events.ts`) can read it under the Node test runner.
 *
 * Why: when a video is moved from the Player (or from the Library while the mini player plays it), the session still
 * reports `paused` / `playerExited` for it afterwards. Those events would write its resume point and its Watch history
 * / Continue watching entry back, and could still count a play. Every event for an id listed here is dropped where the
 * events are sent.
 *
 * It is never saved: a lasting list would link a library id to Private, which the vault's design avoids (the vault
 * keeps its own random ids and never the library id). After a restart the moved id no longer exists anywhere, so
 * nothing can play it.
 */

const moved = new Set<string>();

/** Remembers, for this run only, that library item `mediaId` went to Private. */
export function markMovedToPrivate(mediaId: string): void {
  const id = mediaId.trim();
  if (id) {
    moved.add(id);
  }
}

/** True when `mediaId` was moved to Private in this run (its playback events are dropped). */
export function isMovedToPrivate(mediaId: string | null | undefined): boolean {
  return typeof mediaId === 'string' && moved.size > 0 && moved.has(mediaId);
}

export function __resetPrivateMediaGuardForTests(): void {
  moved.clear();
}
