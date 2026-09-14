import { memo, useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { AppLockPinInput, useAppLockStore } from '@/security/app-lock';

type Step = 'current' | 'new' | 'confirm';

export const AppLockChangePinScreen = memo(function AppLockChangePinScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const changePin = useAppLockStore((s) => s.changePin);
  const authenticatePin = useAppLockStore((s) => s.authenticatePin);
  const isBusy = useAppLockStore((s) => s.isBusy);
  const setupError = useAppLockStore((s) => s.setupError);
  const clearSetupError = useAppLockStore((s) => s.clearSetupError);
  const formEpoch = useAppLockStore((s) => s.formEpoch);
  const status = useAppLockStore((s) => s.status);

  const [step, setStep] = useState<Step>('current');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  useEffect(() => {
    setStep('current');
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    clearSetupError();
  }, [formEpoch, clearSetupError]);

  useEffect(() => {
    if (status === 'LOCKED' && router.canGoBack()) {
      router.back();
    }
  }, [status, router]);

  const errorMessage =
    setupError === 'throttled'
      ? t('appLock.tooManyAttempts')
      : setupError === 'mismatch'
        ? step === 'current'
          ? t('appLock.incorrectPin')
          : t('appLock.pinsDoNotMatch')
        : setupError === 'pin_invalid'
          ? t('appLock.pinInvalid')
          : setupError
            ? t('appLock.updateError')
            : null;

  const commit = useCallback(
    async (confirm: string) => {
      const ok = await changePin(currentPin, newPin, confirm);
      if (ok) {
        Alert.alert(t('appLock.pinChangedTitle'), t('appLock.pinChangedMessage'), [
          {
            text: t('common.ok'),
            onPress: () => {
              if (router.canGoBack()) {
                router.back();
              }
            },
          },
        ]);
        return;
      }
      if (useAppLockStore.getState().setupError === 'mismatch' && step === 'current') {
        setCurrentPin('');
        setStep('current');
      } else {
        setConfirmPin('');
      }
    },
    [changePin, currentPin, newPin, router, step, t],
  );

  return (
    <View
      testID="app-lock-change-pin-screen"
      style={{
        flex: 1,
        backgroundColor: theme.colors.background,
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 24,
      }}>
      <Text variant="title" style={{ marginBottom: 8 }}>
        {t('appLock.changePinTitle')}
      </Text>
      <Text variant="body" color="textSecondary" style={{ marginBottom: 28 }}>
        {step === 'current'
          ? t('appLock.enterCurrentPinHint')
          : step === 'new'
            ? t('appLock.setNewPinHint')
            : t('appLock.confirmNewPinHint')}
      </Text>

      {step === 'current' ? (
        <AppLockPinInput
          value={currentPin}
          onChange={(next) => {
            clearSetupError();
            setCurrentPin(next);
          }}
          onComplete={(value) => {
            void (async () => {
              const ok = await authenticatePin(value);
              if (!ok) {
                setCurrentPin('');
                return;
              }
              setCurrentPin(value);
              setStep('new');
              setNewPin('');
            })();
          }}
          disabled={isBusy}
          error={errorMessage}
          accessibilityLabel={t('appLock.enterCurrentPinA11y')}
          testID="app-lock-change-current"
        />
      ) : null}

      {step === 'new' ? (
        <AppLockPinInput
          value={newPin}
          onChange={(next) => {
            clearSetupError();
            setNewPin(next);
          }}
          onComplete={(value) => {
            setNewPin(value);
            setStep('confirm');
            setConfirmPin('');
          }}
          disabled={isBusy}
          error={errorMessage}
          accessibilityLabel={t('appLock.setNewPinA11y')}
          testID="app-lock-change-new"
        />
      ) : null}

      {step === 'confirm' ? (
        <AppLockPinInput
          value={confirmPin}
          onChange={(next) => {
            clearSetupError();
            setConfirmPin(next);
          }}
          onComplete={(value) => {
            void commit(value);
          }}
          disabled={isBusy}
          error={errorMessage}
          accessibilityLabel={t('appLock.confirmNewPinA11y')}
          testID="app-lock-change-confirm"
        />
      ) : null}

      <View style={{ flex: 1 }} />

      <Button
        title={t('common.cancel')}
        variant="ghost"
        fullWidth
        disabled={isBusy}
        onPress={() => {
          if (router.canGoBack()) {
            router.back();
          }
        }}
        testID="app-lock-change-cancel"
      />
    </View>
  );
});
