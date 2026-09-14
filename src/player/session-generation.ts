/**
 * Stale-async guards for player load / media switch.
 * Old resume, source resolution, and native events must not mutate the
 * currently active media.
 */

export function isCurrentPlayerSession(input: {
  mounted: boolean;
  loadArmed: boolean;
  capturedGeneration: number;
  currentGeneration: number;
  activeMediaId: string | null;
  eventMediaId?: string | null;
}): boolean {
  if (!input.mounted || !input.loadArmed) {
    return false;
  }
  if (input.capturedGeneration !== input.currentGeneration) {
    return false;
  }
  if (!input.activeMediaId) {
    return false;
  }
  if (
    input.eventMediaId != null &&
    input.eventMediaId !== input.activeMediaId
  ) {
    return false;
  }
  return true;
}
