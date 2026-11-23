/**
 * Which feature hears a captured key (`key-capture.service.ts`). Pure.
 *
 * Volume Up / Down go to one owner: the one that asked for them most recently (the Player opened over the Browser
 * takes them; closing it hands them back). Any other key goes to every owner that asked for that combo.
 */

export type KeyOwnerRequest = {
  volumeKeys: boolean;
  combos: readonly string[];
  /** When the owner last started asking for the volume keys (higher = more recent). */
  since: number;
};

const VOLUME_KEYS = new Set(['volumeUp', 'volumeDown']);

export function routeCapturedKey(key: string, requests: ReadonlyMap<string, KeyOwnerRequest>): Set<string> {
  const owners = new Set<string>();
  if (VOLUME_KEYS.has(key)) {
    let latest: { owner: string; since: number } | null = null;
    for (const [owner, request] of requests) {
      if (request.volumeKeys && (latest == null || request.since > latest.since)) {
        latest = { owner, since: request.since };
      }
    }
    if (latest) owners.add(latest.owner);
    return owners;
  }
  const wanted = key.toLowerCase();
  for (const [owner, request] of requests) {
    if (request.combos.some((combo) => combo.toLowerCase() === wanted)) owners.add(owner);
  }
  return owners;
}
