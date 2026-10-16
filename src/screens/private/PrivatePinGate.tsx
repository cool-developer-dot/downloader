import { memo, useEffect, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { useTranslation } from '@/localization';
import { usePrivateVaultPrefs } from '@/private-vault/vault-prefs-store';
import { AppLockPinInput, useAppLockStore } from '@/security/app-lock';

import { PrivateDataLossNotice } from './PrivateDataLossNotice';

export type PrivatePinGateProps = {
  onVerified: () => void;
};

/**
 * Lock File (#413): Private always asks for the App Lock PIN, even when VidoraX itself is unlocked. The PIN is checked
 * by the existing verifier with its throttling (too many wrong PINs wait, exactly as on the lock screen); it stays in
 * this component's state only and is cleared after every attempt.
 */
export const PrivatePinGate = memo(function PrivatePinGate({ onVerified }: PrivatePinGateProps) {
  const { t } = useTranslation();
  const authenticatePin = useAppLockStore((s) => s.authenticatePin);
  const isBusy = useAppLockStore((s) => s.isBusy);
  const setupError = useAppLockStore((s) => s.setupError);
  const clearSetupError = useAppLockStore((s) => s.clearSetupError);
  const [pin, setPin] = useState('');
  const dataLossAcknowledged = usePrivateVaultPrefs((s) => s.dataLossAcknowledged);

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
        disabled={isBusy}
        error={errorMessage}
        accessibilityLabel={t('privateVault.pinA11y')}
        testID="private-pin-input"
      />
    </Box>
  );
});
