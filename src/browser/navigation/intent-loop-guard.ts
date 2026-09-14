/**
 * Bounded per-tab intent fingerprint memory — pure, no React Native.
 */

type LoopGuardEntry = {
  fingerprints: string[];
  epoch: number;
};

const MAX_FINGERPRINTS_PER_TAB = 8;
const loopGuards = new Map<string, LoopGuardEntry>();

/**
 * @returns true if this fingerprint is new for the tab/epoch (should execute).
 *          false if already seen (loop — skip).
 */
export function rememberIntentFingerprint(
  tabId: string,
  epoch: number,
  fingerprint: string,
): boolean {
  let entry = loopGuards.get(tabId);
  if (!entry || entry.epoch !== epoch) {
    entry = { fingerprints: [], epoch };
    loopGuards.set(tabId, entry);
  }
  if (entry.fingerprints.includes(fingerprint)) {
    return false;
  }
  entry.fingerprints.push(fingerprint);
  if (entry.fingerprints.length > MAX_FINGERPRINTS_PER_TAB) {
    entry.fingerprints.shift();
  }
  return true;
}

export function clearIntentLoopGuardForTab(tabId: string): void {
  loopGuards.delete(tabId);
}

/** Test helper */
export function __resetIntentLoopGuardsForTests(): void {
  loopGuards.clear();
}
