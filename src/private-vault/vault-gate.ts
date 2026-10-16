/**
 * App Lock gating for Private (#413). Pure.
 *
 * Nothing private exists without a PIN: the Private entry opens the section only while App Lock is on, and offers to
 * set App Lock up otherwise. Inside, the section asks for the PIN every time it is opened — even when the app itself
 * is unlocked — and locks again the moment the user leaves it or the app leaves the foreground.
 */

export type PrivateEntryAction =
  /** App Lock has not finished starting: do nothing yet. */
  | 'wait'
  /** No PIN yet: offer the existing App Lock setup. */
  | 'offer-app-lock-setup'
  | 'open';

export function privateEntryAction(lock: { bootstrapped: boolean; enabled: boolean }): PrivateEntryAction {
  if (!lock.bootstrapped) {
    return 'wait';
  }
  return lock.enabled ? 'open' : 'offer-app-lock-setup';
}

export type VaultSession = {
  unlocked: boolean;
  /** Bumped on every lock, so work started while unlocked can tell it is stale. */
  generation: number;
};

export type VaultSessionEvent =
  | { type: 'pin-verified' }
  /**
   * The app went to the background (or any state other than active). `externalUi`: a system screen the user opened
   * from inside Private (the folder picker, a permission prompt) is in front — that does not lock.
   */
  | { type: 'app-background'; externalUi?: boolean }
  /** The section lost focus: another screen was opened on top, or the user went back. */
  | { type: 'left-section' }
  /** App Lock was turned off or the whole app locked. */
  | { type: 'app-lock-changed'; enabled: boolean; appLocked: boolean };

export const LOCKED_SESSION: VaultSession = { unlocked: false, generation: 0 };

/** Pure: the session after an event. Only a verified PIN unlocks; everything else can only lock. */
export function reduceVaultSession(session: VaultSession, event: VaultSessionEvent): VaultSession {
  switch (event.type) {
    case 'pin-verified':
      return session.unlocked ? session : { unlocked: true, generation: session.generation + 1 };
    case 'app-lock-changed':
      if (event.enabled && !event.appLocked) {
        return session;
      }
      return lock(session);
    case 'app-background':
      return event.externalUi ? session : lock(session);
    case 'left-section':
      return lock(session);
    default:
      return session;
  }
}

function lock(session: VaultSession): VaultSession {
  return session.unlocked ? { unlocked: false, generation: session.generation + 1 } : session;
}

/** Any app state other than `active` locks the section (background, and `inactive` where the platform has it). */
export function locksOnAppState(state: string): boolean {
  return state !== 'active';
}
