/**
 * Canonical waiting reasons — distinct from DownloadStatus.
 * Device-local runtime only; not persisted to PostgreSQL.
 */

export type QueueWaitingReason =
  | 'CAPACITY'
  | 'WAITING_FOR_WIFI'
  | 'OFFLINE'
  | 'RETRY_DELAY'
  | 'RECOVERY_PENDING';

export const QUEUE_WAITING_REASON_COPY: Record<QueueWaitingReason, string> = {
  CAPACITY: 'Queued',
  WAITING_FOR_WIFI: 'Waiting for Wi-Fi',
  OFFLINE: 'Waiting for network',
  RETRY_DELAY: 'Retrying',
  RECOVERY_PENDING: 'Preparing download',
};

/**
 * Deterministic precedence when multiple conditions apply
 * (lower index = higher priority / more actionable).
 */
export const QUEUE_WAITING_REASON_PRECEDENCE: readonly QueueWaitingReason[] = [
  'RETRY_DELAY',
  'RECOVERY_PENDING',
  'OFFLINE',
  'WAITING_FOR_WIFI',
  'CAPACITY',
] as const;

export function pickWaitingReason(
  candidates: readonly QueueWaitingReason[],
): QueueWaitingReason {
  if (candidates.length === 0) {
    return 'CAPACITY';
  }
  let best: QueueWaitingReason = candidates[0]!;
  let bestRank = QUEUE_WAITING_REASON_PRECEDENCE.indexOf(best);
  for (const reason of candidates) {
    const rank = QUEUE_WAITING_REASON_PRECEDENCE.indexOf(reason);
    if (rank >= 0 && (bestRank < 0 || rank < bestRank)) {
      best = reason;
      bestRank = rank;
    }
  }
  return best;
}

export function formatQueueWaitingReason(reason: QueueWaitingReason): string {
  return QUEUE_WAITING_REASON_COPY[reason];
}
