import {
  APP_LOCK_PIN_THROTTLE_DELAYS_MS,
  APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD,
  APP_LOCK_RECOVERY_THROTTLE_DELAYS_MS,
  APP_LOCK_RECOVERY_THROTTLE_SOFT_THRESHOLD,
} from './app-lock.constants';

export type ThrottleChannel = 'pin' | 'recovery';

export type ThrottleDecision = {
  blocked: boolean;
  delayMs: number;
  retryAfter: number | null;
  failedAttempts: number;
};

function delayForAttempts(
  failedAttempts: number,
  softThreshold: number,
  delays: { after5: number; after6: number; after7Plus: number },
): number {
  if (failedAttempts < softThreshold) {
    return 0;
  }
  if (failedAttempts === softThreshold) {
    return delays.after5;
  }
  if (failedAttempts === softThreshold + 1) {
    return delays.after6;
  }
  return delays.after7Plus;
}

/**
 * Pure throttle policy. Evaluate with wall-clock `now` (ms).
 * Clock skew is a known local-device limitation.
 */
export function resolveAttemptPolicy(input: {
  channel: ThrottleChannel;
  failedAttempts: number;
  now: number;
  retryAfter: number | null;
}): ThrottleDecision {
  const { channel, failedAttempts, now, retryAfter } = input;
  if (typeof retryAfter === 'number' && retryAfter > now) {
    return {
      blocked: true,
      delayMs: retryAfter - now,
      retryAfter,
      failedAttempts,
    };
  }
  return {
    blocked: false,
    delayMs: 0,
    retryAfter: null,
    failedAttempts,
  };
}

/** After a verified failure, compute next attempt count + retryAfter. */
export function nextFailureThrottle(input: {
  channel: ThrottleChannel;
  previousAttempts: number;
  now: number;
}): { failedAttempts: number; retryAfter: number | null; delayMs: number } {
  const failedAttempts = input.previousAttempts + 1;
  const delays =
    input.channel === 'pin'
      ? APP_LOCK_PIN_THROTTLE_DELAYS_MS
      : APP_LOCK_RECOVERY_THROTTLE_DELAYS_MS;
  const soft =
    input.channel === 'pin'
      ? APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD
      : APP_LOCK_RECOVERY_THROTTLE_SOFT_THRESHOLD;
  const delayMs = delayForAttempts(failedAttempts, soft, delays);
  return {
    failedAttempts,
    delayMs,
    retryAfter: delayMs > 0 ? input.now + delayMs : null,
  };
}

export function clearedThrottleState(): {
  failedAttempts: number;
  retryAfter: null;
} {
  return { failedAttempts: 0, retryAfter: null };
}
