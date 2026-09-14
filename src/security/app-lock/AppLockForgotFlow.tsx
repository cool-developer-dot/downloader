import { memo, useCallback, useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { AppLockPinInput } from './AppLockPinInput';
import { useAppLockStore } from './app-lock.store';

type ForgotStep = 'recovery' | 'newPin' | 'confirmPin';

/**
 * Forgot PIN flow rendered inside the lock gate (never mounts private Stack).
 */
export const AppLockForgotFlow = memo(function AppLockForgotFlow({
  testID = 'app-lock-forgot',
}: {
  testID?: string;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const formEpoch = useAppLockStore((s) => s.formEpoch);
  const verifyRecovery = useAppLockStore((s) => s.verifyRecovery);
  const resetPinFromRecovery = useAppLockStore((s) => s.resetPinFromRecovery);
  const closeForgotPin = useAppLockStore((s) => s.closeForgotPin);
  const isBusy = useAppLockStore((s) => s.isBusy);
  const setupError = useAppLockStore((s) => s.setupError);
  const recoveryRetryAfter = useAppLockStore((s) => s.recoveryRetryAfter);
  const clearSetupError = useAppLockStore((s) => s.clearSetupError);
  const refreshThrottleSnapshots = useAppLockStore((s) => s.refreshThrottleSnapshots);

  const [step, setStep] = useState<ForgotStep>('recovery');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [throttleTick, setThrottleTick] = useState(0);

  useEffect(() => {
    setStep('recovery');
    setRecoveryInput('');
    setNewPin('');
    setConfirmPin('');
    clearSetupError();
  }, [formEpoch, clearSetupError]);

  const now = Date.now();
  const throttled =
    typeof recoveryRetryAfter === 'number' && recoveryRetryAfter > now;
  const remainingSec = throttled
    ? Math.max(1, Math.ceil((recoveryRetryAfter! - now) / 1000))
    : 0;

  useEffect(() => {
    if (!throttled || !recoveryRetryAfter) {
      return undefined;
    }
    const delay = Math.max(0, recoveryRetryAfter - Date.now()) + 50;
    const id = setTimeout(() => {
      refreshThrottleSnapshots();
      setThrottleTick((n) => n + 1);
    }, delay);
    return () => clearTimeout(id);
  }, [throttled, recoveryRetryAfter, refreshThrottleSnapshots, throttleTick]);

  const errorMessage =
    setupError === 'throttled'
      ? t('appLock.tooManyAttempts')
      : setupError === 'mismatch'
        ? step === 'recovery'
          ? t('appLock.incorrectRecoveryCode')
          : t('appLock.pinsDoNotMatch')
        : setupError
          ? t('appLock.updateError')
          : throttled
            ? t('appLock.tryAgainShortly')
            : null;

  const submitRecovery = useCallback(async () => {
    const ok = await verifyRecovery(recoveryInput);
    if (ok) {
      setStep('newPin');
      setNewPin('');
      setConfirmPin('');
    } else {
      setRecoveryInput('');
    }
  }, [recoveryInput, verifyRecovery]);

  const submitNewPin = useCallback(
    async (confirm: string) => {
      const ok = await resetPinFromRecovery(newPin, confirm);
      if (!ok) {
        setConfirmPin('');
        if (useAppLockStore.getState().setupError === 'mismatch') {
          // stay on confirm
        }
      }
    },
    [newPin, resetPinFromRecovery],
  );

  return (
    <View
      testID={testID}
      accessibilityViewIsModal
      style={{
        flex: 1,
        backgroundColor: theme.colors.background,
        paddingTop: insets.top + 32,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 24,
      }}>
      <Text variant="title" align="center" style={{ marginBottom: 8 }}>
        {t('appLock.forgotPinTitle')}
      </Text>
      <Text
        variant="body"
        align="center"
        color="textSecondary"
        style={{ marginBottom: 20 }}>
        {step === 'recovery'
          ? t('appLock.enterRecoveryCodeHint')
          : step === 'newPin'
            ? t('appLock.setNewPinHint')
            : t('appLock.confirmNewPinHint')}
      </Text>

      {step === 'recovery' ? (
        <>
          <TextInput
            value={recoveryInput}
            onChangeText={(text) => {
              clearSetupError();
              setRecoveryInput(text);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!isBusy && !throttled}
            placeholder={t('appLock.recoveryCodePlaceholder')}
            placeholderTextColor={theme.colors.textSecondary}
            style={{
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: 12,
              paddingHorizontal: 16,
              paddingVertical: 14,
              color: theme.colors.textPrimary,
              letterSpacing: 1,
              marginBottom: 12,
            }}
            accessibilityLabel={t('appLock.enterRecoveryCodeA11y')}
            testID={`${testID}-recovery-input`}
          />
          {errorMessage ? (
            <Text
              variant="caption"
              color="error"
              align="center"
              accessibilityLiveRegion="polite">
              {throttled
                ? `${t('appLock.tooManyAttempts')} ${t('appLock.tryAgainInSeconds', { seconds: String(remainingSec) })}`
                : errorMessage}
            </Text>
          ) : null}
          <Text
            variant="caption"
            color="textSecondary"
            align="center"
            style={{ marginTop: 16, marginBottom: 16 }}>
            {t('appLock.lostBothWarning')}
          </Text>
          <Button
            title={t('appLock.verifyRecoveryCode')}
            fullWidth
            loading={isBusy}
            disabled={isBusy || throttled || recoveryInput.trim().length < 8}
            onPress={() => {
              void submitRecovery();
            }}
            testID={`${testID}-verify`}
          />
        </>
      ) : null}

      {step === 'newPin' ? (
        <AppLockPinInput
          value={newPin}
          onChange={(next) => {
            clearSetupError();
            setNewPin(next);
          }}
          onComplete={(value) => {
            setNewPin(value);
            setStep('confirmPin');
            setConfirmPin('');
          }}
          disabled={isBusy}
          error={errorMessage}
          accessibilityLabel={t('appLock.setNewPinA11y')}
          testID={`${testID}-new-pin`}
        />
      ) : null}

      {step === 'confirmPin' ? (
        <AppLockPinInput
          value={confirmPin}
          onChange={(next) => {
            clearSetupError();
            setConfirmPin(next);
          }}
          onComplete={(value) => {
            void submitNewPin(value);
          }}
          disabled={isBusy}
          error={errorMessage}
          accessibilityLabel={t('appLock.confirmNewPinA11y')}
          testID={`${testID}-confirm-pin`}
        />
      ) : null}

      <View style={{ flex: 1 }} />

      <Pressable
        onPress={closeForgotPin}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        testID={`${testID}-back`}>
        <Text variant="body" align="center" color="primary">
          {t('common.back')}
        </Text>
      </Pressable>
    </View>
  );
});
