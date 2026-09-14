import type { AppLockBootstrapKind, AppLockStorageReadResult } from './types';

export type AppLockBootstrapDecision =
  | { kind: 'disabled'; cleaned: boolean }
  | { kind: 'locked' }
  | { kind: 'corrupt_enabled'; reason: string }
  | { kind: 'secure_store_error'; message: string };

/**
 * Map storage classification to bootstrap behavior.
 *
 * CORRUPT enabled configs FAIL CLOSED — never silently DISABLED.
 * Only discardable (non-enabled incomplete) pending material may be cleaned.
 */
export function decideBootstrap(
  read: AppLockStorageReadResult,
): AppLockBootstrapDecision {
  switch (read.kind) {
    case 'missing':
      return { kind: 'disabled', cleaned: false };
    case 'valid':
      return { kind: 'locked' };
    case 'corrupt_enabled':
      return { kind: 'corrupt_enabled', reason: read.reason };
    case 'discardable':
      return { kind: 'disabled', cleaned: true };
    case 'read_error':
      return { kind: 'secure_store_error', message: read.message };
    default: {
      const _exhaustive: never = read;
      return _exhaustive;
    }
  }
}

export function bootstrapKindFromDecision(
  decision: AppLockBootstrapDecision,
): AppLockBootstrapKind {
  switch (decision.kind) {
    case 'disabled':
      return 'disabled';
    case 'locked':
      return 'locked';
    case 'corrupt_enabled':
      return 'corrupt_enabled';
    case 'secure_store_error':
      return 'secure_store_error';
    default: {
      const _exhaustive: never = decision;
      return _exhaustive;
    }
  }
}
