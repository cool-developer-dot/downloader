import { createStore } from '@/store/shared/create-store';

import {
  authenticateRecoveryCode,
  beginRecoveryRotation,
  beginSetupPrepare,
  bootstrapAppLock,
  cancelRecoveryRotationSession,
  cancelSetupSession,
  changePin as changePinService,
  clearSensitiveEphemeralState,
  commitRecoveryRotation,
  completeSetupCommit,
  disableWithPin,
  getActiveSetupSession,
  getPinThrottleSnapshot,
  getRecoveryThrottleSnapshot,
  authenticateCurrentPin,
  resetPinAfterRecovery,
  setCachedAppLockRecord,
  unlockWithPin,
} from './app-lock.service';
import { appLockTrace } from './app-lock-trace';
import type { AppLockStatus, LockedSurface } from './types';

export type AppLockGateMode =
  | 'bootstrapping'
  | 'ready'
  | 'integrity_error'
  | 'secure_store_error';

type AppLockState = {
  status: AppLockStatus;
  isBootstrapped: boolean;
  gateMode: AppLockGateMode;
  privateUiMounted: boolean;
  isBusy: boolean;
  unlockError: string | null;
  setupError: string | null;
  integrityReason: string | null;
  isEnabled: boolean;
  pendingRecoveryCode: string | null;
  /** Lock-gate surface while LOCKED (unlock vs forgot). */
  lockedSurface: LockedSurface;
  pinRetryAfter: number | null;
  recoveryRetryAfter: number | null;
  formEpoch: number;
};

type AppLockActions = {
  bootstrap: () => Promise<void>;
  lock: () => void;
  unlock: (pin: string) => Promise<boolean>;
  beginSetup: () => void;
  prepareSetup: (pin: string, confirmPin: string) => Promise<boolean>;
  completeSetup: (acknowledged: boolean) => Promise<boolean>;
  cancelSetup: () => void;
  disable: (pin: string) => Promise<boolean>;
  changePin: (
    currentPin: string,
    newPin: string,
    confirmNewPin: string,
  ) => Promise<boolean>;
  authenticatePin: (pin: string) => Promise<boolean>;
  openForgotPin: () => void;
  closeForgotPin: () => void;
  verifyRecovery: (code: string) => Promise<boolean>;
  resetPinFromRecovery: (newPin: string, confirmNewPin: string) => Promise<boolean>;
  beginRotateRecovery: (currentPin: string) => Promise<boolean>;
  completeRotateRecovery: (acknowledged: boolean) => Promise<boolean>;
  cancelRotateRecovery: () => void;
  clearUnlockError: () => void;
  clearSetupError: () => void;
  retryBootstrap: () => Promise<void>;
  refreshThrottleSnapshots: () => void;
};

export type AppLockStore = AppLockState & AppLockActions;

const initialState: AppLockState = {
  status: 'DISABLED',
  isBootstrapped: false,
  gateMode: 'bootstrapping',
  privateUiMounted: false,
  isBusy: false,
  unlockError: null,
  setupError: null,
  integrityReason: null,
  isEnabled: false,
  pendingRecoveryCode: null,
  lockedSurface: 'unlock',
  pinRetryAfter: null,
  recoveryRetryAfter: null,
  formEpoch: 0,
};

function syncThrottleFromCache(set: (partial: Partial<AppLockState>) => void): void {
  const pin = getPinThrottleSnapshot();
  const recovery = getRecoveryThrottleSnapshot();
  set({
    pinRetryAfter: pin.retryAfter,
    recoveryRetryAfter: recovery.retryAfter,
  });
}

export const useAppLockStore = createStore<AppLockStore>((set, get) => ({
  ...initialState,

  bootstrap: async () => {
    if (get().isBusy && get().gateMode === 'bootstrapping') {
      return;
    }
    set({
      isBusy: true,
      gateMode: 'bootstrapping',
      isBootstrapped: false,
      unlockError: null,
      lockedSurface: 'unlock',
    });
    try {
      const result = await bootstrapAppLock();
      if (result.status === 'DISABLED') {
        setCachedAppLockRecord(null);
        set({
          status: 'DISABLED',
          isBootstrapped: true,
          gateMode: 'ready',
          privateUiMounted: true,
          isEnabled: false,
          isBusy: false,
          integrityReason: null,
          pinRetryAfter: null,
          recoveryRetryAfter: null,
        });
        return;
      }
      if (result.status === 'LOCKED') {
        setCachedAppLockRecord(result.record);
        set({
          status: 'LOCKED',
          isBootstrapped: true,
          gateMode: 'ready',
          privateUiMounted: false,
          isEnabled: true,
          isBusy: false,
          integrityReason: null,
          lockedSurface: 'unlock',
          pinRetryAfter: result.record.pinRetryAfter,
          recoveryRetryAfter: result.record.recoveryRetryAfter,
        });
        return;
      }
      if (result.status === 'CORRUPT_ENABLED') {
        set({
          status: 'LOCKED',
          isBootstrapped: true,
          gateMode: 'integrity_error',
          privateUiMounted: false,
          isEnabled: true,
          isBusy: false,
          integrityReason: result.reason,
        });
        return;
      }
      set({
        status: 'LOCKED',
        isBootstrapped: true,
        gateMode: 'secure_store_error',
        privateUiMounted: false,
        isEnabled: true,
        isBusy: false,
        integrityReason: result.message,
      });
    } catch {
      set({
        status: 'LOCKED',
        isBootstrapped: true,
        gateMode: 'secure_store_error',
        privateUiMounted: false,
        isEnabled: true,
        isBusy: false,
        integrityReason: 'bootstrap_threw',
      });
    }
  },

  retryBootstrap: async () => {
    set({ isBootstrapped: false, gateMode: 'bootstrapping' });
    await get().bootstrap();
  },

  lock: () => {
    const { status, isEnabled, isBootstrapped } = get();
    if (!isBootstrapped || !isEnabled || status === 'DISABLED') {
      return;
    }
    clearSensitiveEphemeralState();
    if (status === 'LOCKED') {
      set({
        pendingRecoveryCode: null,
        lockedSurface: 'unlock',
        unlockError: null,
        setupError: null,
        formEpoch: get().formEpoch + 1,
      });
      return;
    }
    appLockTrace('LOCKED_ON_BACKGROUND');
    set({
      status: 'LOCKED',
      unlockError: null,
      setupError: null,
      pendingRecoveryCode: null,
      lockedSurface: 'unlock',
      formEpoch: get().formEpoch + 1,
    });
  },

  unlock: async (pin: string) => {
    const { status, isBusy, isEnabled } = get();
    if (!isEnabled || status !== 'LOCKED' || isBusy) {
      return false;
    }
    set({ isBusy: true, unlockError: null });
    try {
      const result = await unlockWithPin(pin);
      syncThrottleFromCache(set);
      if (result.ok) {
        set({
          status: 'UNLOCKED',
          privateUiMounted: true,
          isBusy: false,
          unlockError: null,
          lockedSurface: 'unlock',
        });
        return true;
      }
      set({
        status: 'LOCKED',
        isBusy: false,
        unlockError:
          result.reason === 'throttled'
            ? 'throttled'
            : result.reason === 'error'
              ? 'error'
              : result.reason === 'invalid_input'
                ? 'mismatch'
                : 'mismatch',
        pinRetryAfter: result.retryAfter ?? get().pinRetryAfter,
      });
      return false;
    } catch {
      set({
        status: 'LOCKED',
        isBusy: false,
        unlockError: 'error',
      });
      return false;
    }
  },

  beginSetup: () => {
    cancelSetupSession();
    set({
      setupError: null,
      pendingRecoveryCode: null,
    });
  },

  prepareSetup: async (pin: string, confirmPin: string) => {
    if (get().isBusy) {
      return false;
    }
    set({ isBusy: true, setupError: null });
    try {
      const result = await beginSetupPrepare(pin, confirmPin);
      if (!result.ok) {
        set({
          isBusy: false,
          setupError: result.reason,
          pendingRecoveryCode: null,
        });
        return false;
      }
      set({
        isBusy: false,
        setupError: null,
        pendingRecoveryCode: result.session.recoveryCodePlaintext,
      });
      return true;
    } catch {
      set({ isBusy: false, setupError: 'error', pendingRecoveryCode: null });
      return false;
    }
  },

  completeSetup: async (acknowledged: boolean) => {
    if (get().isBusy) {
      return false;
    }
    if (!getActiveSetupSession()) {
      set({ setupError: 'not_ready' });
      return false;
    }
    set({ isBusy: true, setupError: null });
    try {
      const result = await completeSetupCommit(acknowledged);
      if (!result.ok) {
        set({ isBusy: false, setupError: result.reason });
        return false;
      }
      set({
        status: 'UNLOCKED',
        isEnabled: true,
        privateUiMounted: true,
        isBusy: false,
        setupError: null,
        pendingRecoveryCode: null,
        gateMode: 'ready',
        pinRetryAfter: null,
        recoveryRetryAfter: null,
      });
      return true;
    } catch {
      set({ isBusy: false, setupError: 'error' });
      return false;
    }
  },

  cancelSetup: () => {
    cancelSetupSession();
    set({
      setupError: null,
      pendingRecoveryCode: null,
      isBusy: false,
    });
  },

  disable: async (pin: string) => {
    if (get().isBusy || !get().isEnabled) {
      return false;
    }
    set({ isBusy: true, setupError: null });
    try {
      const result = await disableWithPin(pin);
      syncThrottleFromCache(set);
      if (!result.ok) {
        set({
          isBusy: false,
          setupError:
            result.reason === 'throttled'
              ? 'throttled'
              : result.reason === 'mismatch'
                ? 'mismatch'
                : 'error',
        });
        return false;
      }
      set({
        status: 'DISABLED',
        isEnabled: false,
        privateUiMounted: true,
        isBusy: false,
        setupError: null,
        pendingRecoveryCode: null,
        unlockError: null,
        pinRetryAfter: null,
        recoveryRetryAfter: null,
      });
      return true;
    } catch {
      set({ isBusy: false, setupError: 'error' });
      return false;
    }
  },

  changePin: async (currentPin, newPin, confirmNewPin) => {
    if (get().isBusy || !get().isEnabled || get().status !== 'UNLOCKED') {
      return false;
    }
    set({ isBusy: true, setupError: null });
    try {
      const result = await changePinService(currentPin, newPin, confirmNewPin);
      syncThrottleFromCache(set);
      if (!result.ok) {
        set({
          isBusy: false,
          setupError:
            result.reason === 'throttled'
              ? 'throttled'
              : result.reason === 'mismatch'
                ? 'mismatch'
                : result.reason === 'invalid_input'
                  ? 'pin_invalid'
                  : 'error',
        });
        return false;
      }
      set({ isBusy: false, setupError: null });
      return true;
    } catch {
      set({ isBusy: false, setupError: 'error' });
      return false;
    }
  },

  authenticatePin: async (pin: string) => {
    if (get().isBusy || !get().isEnabled) {
      return false;
    }
    set({ isBusy: true, setupError: null });
    try {
      const result = await authenticateCurrentPin(pin);
      syncThrottleFromCache(set);
      if (!result.ok) {
        set({
          isBusy: false,
          setupError:
            result.reason === 'throttled'
              ? 'throttled'
              : result.reason === 'mismatch'
                ? 'mismatch'
                : 'error',
        });
        return false;
      }
      set({ isBusy: false, setupError: null });
      return true;
    } catch {
      set({ isBusy: false, setupError: 'error' });
      return false;
    }
  },

  openForgotPin: () => {
    if (get().status !== 'LOCKED') {
      return;
    }
    set({
      lockedSurface: 'forgot',
      unlockError: null,
      setupError: null,
      formEpoch: get().formEpoch + 1,
    });
  },

  closeForgotPin: () => {
    clearSensitiveEphemeralState();
    set({
      lockedSurface: 'unlock',
      setupError: null,
      unlockError: null,
      pendingRecoveryCode: null,
      formEpoch: get().formEpoch + 1,
    });
  },

  verifyRecovery: async (code: string) => {
    if (get().isBusy || get().status !== 'LOCKED') {
      return false;
    }
    set({ isBusy: true, setupError: null });
    try {
      const result = await authenticateRecoveryCode(code);
      syncThrottleFromCache(set);
      if (!result.ok) {
        set({
          isBusy: false,
          setupError:
            result.reason === 'throttled'
              ? 'throttled'
              : result.reason === 'mismatch'
                ? 'mismatch'
                : 'error',
          recoveryRetryAfter: result.retryAfter ?? get().recoveryRetryAfter,
        });
        return false;
      }
      set({ isBusy: false, setupError: null });
      return true;
    } catch {
      set({ isBusy: false, setupError: 'error' });
      return false;
    }
  },

  resetPinFromRecovery: async (newPin, confirmNewPin) => {
    if (get().isBusy || get().status !== 'LOCKED') {
      return false;
    }
    set({ isBusy: true, setupError: null });
    try {
      const result = await resetPinAfterRecovery(newPin, confirmNewPin);
      if (!result.ok) {
        set({
          isBusy: false,
          setupError:
            result.reason === 'mismatch'
              ? 'mismatch'
              : result.reason === 'invalid_input'
                ? 'pin_invalid'
                : 'error',
        });
        return false;
      }
      set({
        status: 'UNLOCKED',
        privateUiMounted: true,
        isBusy: false,
        setupError: null,
        unlockError: null,
        lockedSurface: 'unlock',
        pinRetryAfter: null,
        recoveryRetryAfter: null,
      });
      return true;
    } catch {
      set({ isBusy: false, setupError: 'error' });
      return false;
    }
  },

  beginRotateRecovery: async (currentPin: string) => {
    if (get().isBusy || get().status !== 'UNLOCKED') {
      return false;
    }
    set({ isBusy: true, setupError: null, pendingRecoveryCode: null });
    try {
      const result = await beginRecoveryRotation(currentPin);
      syncThrottleFromCache(set);
      if (!result.ok) {
        set({
          isBusy: false,
          setupError:
            result.reason === 'throttled'
              ? 'throttled'
              : result.reason === 'mismatch'
                ? 'mismatch'
                : 'error',
        });
        return false;
      }
      set({
        isBusy: false,
        setupError: null,
        pendingRecoveryCode: result.session.recoveryCodePlaintext,
      });
      return true;
    } catch {
      set({ isBusy: false, setupError: 'error' });
      return false;
    }
  },

  completeRotateRecovery: async (acknowledged: boolean) => {
    if (get().isBusy) {
      return false;
    }
    set({ isBusy: true, setupError: null });
    try {
      const result = await commitRecoveryRotation(acknowledged);
      if (!result.ok) {
        set({ isBusy: false, setupError: 'error' });
        return false;
      }
      set({
        isBusy: false,
        setupError: null,
        pendingRecoveryCode: null,
      });
      return true;
    } catch {
      set({ isBusy: false, setupError: 'error' });
      return false;
    }
  },

  cancelRotateRecovery: () => {
    cancelRecoveryRotationSession();
    set({
      pendingRecoveryCode: null,
      setupError: null,
      isBusy: false,
    });
  },

  refreshThrottleSnapshots: () => {
    syncThrottleFromCache(set);
  },

  clearUnlockError: () => set({ unlockError: null }),
  clearSetupError: () => set({ setupError: null }),
}));

export const selectAppLockStatus = (s: AppLockStore) => s.status;
export const selectAppLockBootstrapped = (s: AppLockStore) => s.isBootstrapped;
export const selectAppLockEnabled = (s: AppLockStore) => s.isEnabled;
export const selectAppLockGateMode = (s: AppLockStore) => s.gateMode;
export const selectPrivateUiMounted = (s: AppLockStore) => s.privateUiMounted;
