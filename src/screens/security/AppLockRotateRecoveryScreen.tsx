import { memo, useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { AppLockPinInput, useAppLockStore } from '@/security/app-lock';

type Step = 'pin' | 'show';

export const AppLockRotateRecoveryScreen = memo(function AppLockRotateRecoveryScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const beginRotateRecovery = useAppLockStore((s) => s.beginRotateRecovery);
  const completeRotateRecovery = useAppLockStore((s) => s.completeRotateRecovery);
  const cancelRotateRecovery = useAppLockStore((s) => s.cancelRotateRecovery);
  const pendingRecoveryCode = useAppLockStore((s) => s.pendingRecoveryCode);
  const isBusy = useAppLockStore((s) => s.isBusy);
  const setupError = useAppLockStore((s) => s.setupError);
  const clearSetupError = useAppLockStore((s) => s.clearSetupError);
  const formEpoch = useAppLockStore((s) => s.formEpoch);
  const status = useAppLockStore((s) => s.status);

  const [step, setStep] = useState<Step>('pin');
  const [pin, setPin] = useState('');
  const [savedChecked, setSavedChecked] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setStep('pin');
    setPin('');
    setSavedChecked(false);
    setLocalError(null);
    cancelRotateRecovery();
  }, [formEpoch, cancelRotateRecovery]);

  useEffect(() => {
    if (status === 'LOCKED') {
      cancelRotateRecovery();
      if (router.canGoBack()) {
        router.back();
      }
    }
  }, [status, router, cancelRotateRecovery]);

  const errorMessage =
    localError ??
    (setupError === 'throttled'
      ? t('appLock.tooManyAttempts')
      : setupError === 'mismatch'
        ? t('appLock.incorrectPin')
        : setupError
          ? t('appLock.updateError')
          : null);

  const onPinComplete = useCallback(
    async (value: string) => {
      const ok = await beginRotateRecovery(value);
      if (!ok) {
        setPin('');
        return;
      }
      setStep('show');
      setSavedChecked(false);
    },
    [beginRotateRecovery],
  );

  const onCommit = useCallback(async () => {
    if (!savedChecked) {
      setLocalError(t('appLock.mustConfirmSaved'));
      return;
    }
    const ok = await completeRotateRecovery(true);
    if (ok) {
      if (router.canGoBack()) {
        router.back();
      }
      return;
    }
    setLocalError(t('appLock.updateError'));
  }, [completeRotateRecovery, router, savedChecked, t]);

  return (
    <ScrollView
      testID="app-lock-rotate-recovery-screen"
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 24,
        backgroundColor: theme.colors.background,
      }}
      keyboardShouldPersistTaps="handled">
      <Text variant="title" style={{ marginBottom: 8 }}>
        {t('appLock.generateRecoveryTitle')}
      </Text>
      <Text variant="body" color="textSecondary" style={{ marginBottom: 28 }}>
        {step === 'pin'
          ? t('appLock.generateRecoveryPinHint')
          : t('appLock.generateRecoveryHint')}
      </Text>

      {step === 'pin' ? (
        <AppLockPinInput
          value={pin}
          onChange={(next) => {
            clearSetupError();
            setLocalError(null);
            setPin(next);
          }}
          onComplete={(value) => {
            void onPinComplete(value);
          }}
          disabled={isBusy}
          error={errorMessage}
          accessibilityLabel={t('appLock.enterCurrentPinA11y')}
          testID="app-lock-rotate-pin"
        />
      ) : null}

      {step === 'show' && pendingRecoveryCode ? (
        <View style={{ gap: 16 }}>
          <Text variant="caption" color="textSecondary">
            {t('appLock.previousRecoveryWillStop')}
          </Text>
          <View
            accessible
            accessibilityLabel={t('appLock.recoveryCodeA11y')}
            style={{
              padding: 20,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface,
            }}>
            <Text
              variant="subtitle"
              align="center"
              style={{ letterSpacing: 1.5 }}
              testID="app-lock-new-recovery-code">
              {pendingRecoveryCode}
            </Text>
          </View>
          <Button
            title={t('appLock.copyRecoveryCode')}
            variant="secondary"
            fullWidth
            onPress={() => {
              void Clipboard.setStringAsync(pendingRecoveryCode).catch(() => undefined);
            }}
            testID="app-lock-rotate-copy"
          />
          <Pressable
            onPress={() => setSavedChecked((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: savedChecked }}
            accessibilityLabel={t('appLock.savedNewRecoveryConfirm')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
            testID="app-lock-rotate-saved">
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                borderWidth: 2,
                borderColor: savedChecked ? theme.colors.primary : theme.colors.border,
                backgroundColor: savedChecked ? theme.colors.primary : 'transparent',
              }}
            />
            <Text variant="body" style={{ flex: 1 }}>
              {t('appLock.savedNewRecoveryConfirm')}
            </Text>
          </Pressable>
          {errorMessage ? (
            <Text variant="caption" color="error">
              {errorMessage}
            </Text>
          ) : null}
          <Button
            title={t('appLock.saveNewRecovery')}
            fullWidth
            loading={isBusy}
            disabled={isBusy || !savedChecked}
            onPress={() => {
              void onCommit();
            }}
            testID="app-lock-rotate-commit"
          />
        </View>
      ) : null}

      <View style={{ flex: 1, minHeight: 24 }} />

      <Button
        title={t('common.cancel')}
        variant="ghost"
        fullWidth
        disabled={isBusy}
        onPress={() => {
          cancelRotateRecovery();
          if (router.canGoBack()) {
            router.back();
          }
        }}
        testID="app-lock-rotate-cancel"
      />
    </ScrollView>
  );
});
