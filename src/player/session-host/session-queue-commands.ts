/**
 * P15 #661 / #701 in the mini player (Faran, with the P5 / P6 move into the session runner): a headset's, a remote's or
 * the notification's ⏭ / ⏮ while no full Player shows the session. The full Player handles them itself
 * (`use-headset-keys.ts`); here the runner does the same with the play queue: ⏭ opens the next video, ⏮ goes back to
 * the start after the first 3 s, and to the previous video before that. Pure, so it is unit tested.
 */

import { previousTarget } from '../engine/player-keys';
import { queueNeighbours } from '../play-queue';

export type SessionQueueCommandOutcome = { kind: 'open'; mediaId: string } | { kind: 'restart' } | { kind: 'none' };

export function sessionQueueCommand(
  command: 'next' | 'previous',
  input: { ids: readonly string[]; mediaId: string | null; positionSeconds: number },
): SessionQueueCommandOutcome {
  const { previousId, nextId } = queueNeighbours(input.ids, input.mediaId);
  if (command === 'next') {
    return nextId ? { kind: 'open', mediaId: nextId } : { kind: 'none' };
  }
  return previousTarget(input.positionSeconds, previousId != null) === 'previous' && previousId
    ? { kind: 'open', mediaId: previousId }
    : { kind: 'restart' };
}
