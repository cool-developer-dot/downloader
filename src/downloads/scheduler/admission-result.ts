/**
 * Typed admission outcomes — replaces ambiguous boolean onAdmit results.
 * Scheduler interprets these to requeue, remove, or mark active.
 */

export type AdmissionBlockReason =
  | 'PAUSED'
  | 'CANCELLED'
  | 'TERMINAL'
  | 'OFFLINE'
  | 'WAITING_FOR_WIFI'
  | 'CAPACITY'
  | 'ALREADY_ACTIVE'
  | 'ALREADY_STARTING'
  | 'SUPPRESSED'
  | 'TRANSIENT_ADMIT_FAILURE'
  | 'LOCK_HELD'
  | 'FGS_NOT_ADMITTED'
  | 'INVALID_RECORD';

export type AdmissionResult =
  | { outcome: 'STARTED' }
  | { outcome: 'REQUEUE'; reason: AdmissionBlockReason }
  | { outcome: 'TERMINAL'; reason: AdmissionBlockReason | string }
  | { outcome: 'HANDOFF_REQUEUED'; reason: string };

export function admissionStarted(): AdmissionResult {
  return { outcome: 'STARTED' };
}

export function admissionRequeue(reason: AdmissionBlockReason): AdmissionResult {
  return { outcome: 'REQUEUE', reason };
}

export function admissionTerminal(
  reason: AdmissionBlockReason | string,
): AdmissionResult {
  return { outcome: 'TERMINAL', reason };
}

export function admissionHandoff(reason: string): AdmissionResult {
  return { outcome: 'HANDOFF_REQUEUED', reason };
}

/** Normalize legacy boolean hooks in tests. */
export function normalizeAdmissionResult(
  value: AdmissionResult | boolean,
): AdmissionResult {
  if (typeof value === 'boolean') {
    return value
      ? admissionStarted()
      : admissionRequeue('TRANSIENT_ADMIT_FAILURE');
  }
  return value;
}
