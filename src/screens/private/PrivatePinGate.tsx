import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { useTranslation } from '@/localization';
import { unlockPrivateWithBiometrics } from '@/private-vault/vault-biometric';
import { usePrivateVaultPrefs } from '@/private-vault/vault-prefs-store';
import { AppLockPinInput, useAppLockStore } from '@/security/app-lock';
import { useBiometricUnlockPrefs } from '@/security/app-lock/biometric-prefs-store';
import { offersBiometricUnlock, type BiometricOutcome } from '@/security/app-lock/biometric-unlock';
import { promptBiometrics, useBiometricAvailability } from '@/security/app-lock/use-biometric-unlock';

import { PrivateDataLossNotice } from './PrivateDataLossNotice';

export type PrivatePinGateProps = {
  onVerified: () => void;
};

/**
 * Lock File (#413): Private always asks for the App Lock PIN, even when VidoraX itself is unlocked. The PIN is checked
 * by the existing verifier with its throttling (too many wrong PINs wait, exactly as on the lock screen); it stays in
 * this component's state only and is cleared after every attempt. With App Lock's "Unlock with fingerprint or face"
 * on, the biometric prompt opens once and stays one tap away; the PIN (and its throttling) is untouched.
 */
export const PrivatePinGate = memo(function PrivatePinGate({ onVerified }: PrivatePinGateProps) {
  const { t } = useTranslation();
  const authenticatePin = useAppLockStore((s) => s.authenticatePin);
  const isBusy = useAppLockStore((s) => s.isBusy);
  const setupError = useAppLockStore((s) => s.setupError);
  const clearSetupError = useAppLockStore((s) => s.clearSetupError);
  const [pin, setPin] = useState('');
  const dataLossAcknowledged = usePrivateVaultPrefs((s) => s.dataLossAcknowledged);
  const isEnabled = useAppLockStore((s) => s.isEnabled);
  const biometricOn = useBiometricUnlockPrefs((s) => s.enabled);
  const biometricAvailable = useBiometricAvailability();
  // "locked" here is Private's own gate, shown whenever Private asks again.
  const offersBiometric = offersBiometricUnlock({
    settingOn: biometricOn,
    appLockEnabled: isEnabled,
    available: biometricAvailable,
    locked: true,
  });
  const [biometricResult, setBiometricResult] = useState<BiometricOutcome | null>(null);
  const [prompting, setPrompting] = useState(false);
  const promptedRef = useRef(false);

  const promptBiometric = useCallback(async () => {
    setBiometricResult(null);
    setPrompting(true);
    const outcome = await unlockPrivateWithBiometrics(() =>
      promptBiometrics({ promptMessage: t('privateVault.pinTitle'), cancelLabel: t('appLock.biometricUsePin') }),
    );
    setPrompting(false);
    setBiometricResult(outcome);
    if (outcome === 'success') {
      onVerified();
    }
  }, [onVerified, t]);

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

  const errorMessage =
    setupError === 'throttled'
      ? t('appLock.tooManyAttempts')
      : setupError === 'mismatch'
        ? t('appLock.incorrectPin')
        : setupError
          ? t('appLock.updateError')
          : biometricResult === 'lockout'
            ? t('appLock.biometricLockout')
            : biometricResult === 'failed'
              ? t('appLock.biometricFailed')
              : null;

  return (
    <Box px={24} pt={24} gap={8} testID="private-pin-gate">
      <Text variant="title">{t('privateVault.pinTitle')}</Text>
      <Text variant="body" color="textSecondary" style={{ marginBottom: 20 }}>
        {t('privateVault.pinHint')}
      </Text>
      {/* The first time Private is opened, before any move, it says where private videos live and what loses them. */}
      {!dataLossAcknowledged ? (
        <Box mb={20}>
          <PrivateDataLossNotice testID="private-pin-gate-data-loss" />
        </Box>
      ) : null}
      <AppLockPinInput
        value={pin}
        onChange={(next) => {
          clearSetupError();
          setBiometricResult(null);
          setPin(next);
        }}
        onComplete={(value) => {
          void (async () => {
            const ok = await authenticatePin(value);
            setPin('');
            if (ok) {
              onVerified();
            }
          })();
        }}
        disabled={isBusy || prompting}
        error={errorMessage}
        accessibilityLabel={t('privateVault.pinA11y')}
        testID="private-pin-input"
      />
      {offersBiometric ? (
        <Pressable
          onPress={() => {
            void promptBiometric();
          }}
          disabled={isBusy || prompting}
          accessibilityRole="button"
          accessibilityLabel={t('appLock.biometricUnlock')}
          style={{ marginTop: 20, paddingVertical: 10, alignSelf: 'center' }}
          testID="private-pin-gate-biometric">
          <Text variant="body" align="center" color="primary">
            {t('appLock.biometricUnlock')}
          </Text>
        </Pressable>
      ) : null}
    </Box>
  );
});
