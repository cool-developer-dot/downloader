import { useCallback, useEffect, useRef, useState } from 'react';

import { useTranslation } from '@/localization';
import { unlockPrivateWithBiometrics } from '@/private-vault/vault-biometric';
import { useAppLockStore } from '@/security/app-lock';
import { useBiometricUnlockPrefs } from '@/security/app-lock/biometric-prefs-store';
import { offersBiometricUnlock, type BiometricOutcome } from '@/security/app-lock/biometric-unlock';
import { promptBiometrics, useBiometricAvailability } from '@/security/app-lock/use-biometric-unlock';

import { EMPTY_PIN_PAD, reducePinPad, type PinPadKey, type PinPadState } from './pin-pad';

/**
 * Private's PIN gate logic (Lock File #413), shared by Private (design 28) and a locked folder (F10 #910): the App Lock
 * PIN checked by the existing verifier with its throttling (too many wrong PINs wait, as on the lock screen), kept in
 * this hook's state only and cleared after every attempt; with App Lock's "Unlock with fingerprint or face" on, the
 * biometric prompt opens once by itself and stays one key away (#912). A wrong PIN shakes the pad and says "Wrong PIN".
 */
export function usePinGate({ onVerified, promptMessage }: { onVerified: () => void; promptMessage: string }) {
  const { t } = useTranslation();
  const authenticatePin = useAppLockStore((s) => s.authenticatePin);
  const isBusy = useAppLockStore((s) => s.isBusy);
  const setupError = useAppLockStore((s) => s.setupError);
  const clearSetupError = useAppLockStore((s) => s.clearSetupError);
  const isEnabled = useAppLockStore((s) => s.isEnabled);
  const biometricOn = useBiometricUnlockPrefs((s) => s.enabled);
  const biometricAvailable = useBiometricAvailability();
  // "locked" here is the gate's own: shown whenever it asks again.
  const offersBiometric = offersBiometricUnlock({
    settingOn: biometricOn,
    appLockEnabled: isEnabled,
    available: biometricAvailable,
    locked: true,
  });
  const [pad, setPad] = useState<PinPadState>(EMPTY_PIN_PAD);
  const padRef = useRef<PinPadState>(EMPTY_PIN_PAD);
  const [biometricResult, setBiometricResult] = useState<BiometricOutcome | null>(null);
  const [prompting, setPrompting] = useState(false);
  const promptedRef = useRef(false);

  const applyPad = useCallback((next: PinPadState) => {
    padRef.current = next;
    setPad(next);
  }, []);

  const promptBiometric = useCallback(async () => {
    setBiometricResult(null);
    setPrompting(true);
    const outcome = await unlockPrivateWithBiometrics(() =>
      promptBiometrics({ promptMessage, cancelLabel: t('appLock.biometricUsePin') }),
    );
    setPrompting(false);
    setBiometricResult(outcome);
    if (outcome === 'success') {
      onVerified();
    }
  }, [onVerified, promptMessage, t]);

  useEffect(() => {
    if (offersBiometric && !promptedRef.current) {
      promptedRef.current = true;
      void promptBiometric();
    }
  }, [offersBiometric, promptBiometric]);

  useEffect(() => {
    clearSetupError();
    return () => clearSetupError();
  }, [clearSetupError]);

  const onKey = useCallback(
    (key: PinPadKey) => {
      if (key === 'biometric') {
        void promptBiometric();
        return;
      }
      clearSetupError();
      setBiometricResult(null);
      const step = reducePinPad(padRef.current, { type: 'key', key });
      applyPad(step.state);
      const pin = step.complete;
      if (!pin) {
        return;
      }
      void (async () => {
        const ok = await authenticatePin(pin);
        if (ok) {
          applyPad(reducePinPad(padRef.current, { type: 'clear' }).state);
          onVerified();
          return;
        }
        const wrong = useAppLockStore.getState().setupError === 'mismatch';
        applyPad(reducePinPad(padRef.current, { type: wrong ? 'wrong' : 'clear' }).state);
      })();
    },
    [applyPad, authenticatePin, clearSetupError, onVerified, promptBiometric],
  );

  const message =
    setupError === 'throttled'
      ? t('appLock.tooManyAttempts')
      : setupError === 'mismatch'
        ? t('fileManager.wrongPin')
        : setupError
          ? t('appLock.updateError')
          : biometricResult === 'lockout'
            ? t('appLock.biometricLockout')
            : biometricResult === 'failed'
              ? t('appLock.biometricFailed')
              : null;

  return { pad, onKey, offersBiometric, disabled: isBusy || prompting, message };
}
