import { memo, useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import {
  AppLockPinInput,
  useAppLockStore,
} from '@/security/app-lock';

type SetupStep = 'set' | 'confirm' | 'recovery';

/**
 * Single-screen App Lock enable flow. PIN/recovery never enter route params.
 */
export const AppLockSetupScreen = memo(function AppLockSetupScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const prepareSetup = useAppLockStore((s) => s.prepareSetup);
  const completeSetup = useAppLockStore((s) => s.completeSetup);
  const cancelSetup = useAppLockStore((s) => s.cancelSetup);
  const isBusy = useAppLockStore((s) => s.isBusy);
  const setupError = useAppLockStore((s) => s.setupError);
  const pendingRecoveryCode = useAppLockStore((s) => s.pendingRecoveryCode);
  const clearSetupError = useAppLockStore((s) => s.clearSetupError);

  const [step, setStep] = useState<SetupStep>('set');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [savedChecked, setSavedChecked] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const exit = useCallback(() => {
    cancelSetup();
    if (router.canGoBack()) {
      router.back();
    }
  }, [cancelSetup, router]);

  const handleSetComplete = useCallback((value: string) => {
    setPin(value);
    setStep('confirm');
    setConfirmPin('');
    setLocalError(null);
    clearSetupError();
  }, [clearSetupError]);

  const handleConfirmComplete = useCallback(
    async (value: string) => {
      setConfirmPin(value);
      if (value !== pin) {
        setLocalError(t('appLock.pinsDoNotMatch'));
        setConfirmPin('');
        setStep('confirm');
        return;
      }
      const ok = await prepareSetup(pin, value);
      if (!ok) {
        const reason = useAppLockStore.getState().setupError;
        if (reason === 'mismatch') {
          setLocalError(t('appLock.pinsDoNotMatch'));
        } else {
          setLocalError(t('appLock.setupError'));
        }
        setConfirmPin('');
        return;
      }
      setLocalError(null);
      setStep('recovery');
    },
    [pin, prepareSetup, t],
  );

  const handleCopy = useCallback(async () => {
    if (!pendingRecoveryCode) {
      return;
    }
    try {
      await Clipboard.setStringAsync(pendingRecoveryCode);
    } catch {
      // Soft-fail; do not log clipboard contents.
    }
  }, [pendingRecoveryCode]);

  const handleCommit = useCallback(async () => {
    if (!savedChecked) {
      setLocalError(t('appLock.mustConfirmSaved'));
      return;
    }
    const ok = await completeSetup(true);
    if (ok) {
      if (router.canGoBack()) {
        router.back();
      }
      return;
    }
    setLocalError(t('appLock.setupError'));
  }, [completeSetup, router, savedChecked, t]);

  const errorText =
    localError ??
    (setupError === 'mismatch'
      ? t('appLock.pinsDoNotMatch')
      : setupError && setupError !== 'not_acked' && setupError !== 'not_ready'
        ? t('appLock.setupError')
        : null);

  return (
    <ScrollView
      testID="app-lock-setup-screen"
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 24,
        backgroundColor: theme.colors.background,
      }}
      keyboardShouldPersistTaps="handled">
      <Text variant="title" style={{ marginBottom: 8 }}>
        {step === 'recovery' ? t('appLock.recoveryTitle') : t('appLock.setPinTitle')}
      </Text>
      <Text variant="body" color="textSecondary" style={{ marginBottom: 28 }}>
        {step === 'set'
          ? t('appLock.setPinHint')
          : step === 'confirm'
            ? t('appLock.confirmPinHint')
            : t('appLock.recoveryHint')}
      </Text>

      {step === 'set' ? (
        <AppLockPinInput
          value={pin}
          onChange={(next) => {
            setLocalError(null);
            setPin(next);
          }}
          onComplete={handleSetComplete}
          disabled={isBusy}
          error={errorText}
          accessibilityLabel={t('appLock.setPinA11y')}
          testID="app-lock-setup-set-pin"
        />
      ) : null}

      {step === 'confirm' ? (
        <AppLockPinInput
          value={confirmPin}
          onChange={(next) => {
            setLocalError(null);
            clearSetupError();
            setConfirmPin(next);
          }}
          onComplete={(value) => {
            void handleConfirmComplete(value);
          }}
          disabled={isBusy}
          error={errorText}
          accessibilityLabel={t('appLock.confirmPinA11y')}
          testID="app-lock-setup-confirm-pin"
        />
      ) : null}

      {step === 'recovery' && pendingRecoveryCode ? (
        <View style={{ gap: 20 }}>
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
              testID="app-lock-recovery-code">
              {pendingRecoveryCode}
            </Text>
          </View>

          <Button
            title={t('appLock.copyRecoveryCode')}
            variant="secondary"
            fullWidth
            onPress={() => {
              void handleCopy();
            }}
            testID="app-lock-copy-recovery"
          />

          <Pressable
            onPress={() => setSavedChecked((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: savedChecked }}
            accessibilityLabel={t('appLock.savedRecoveryConfirm')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
            testID="app-lock-saved-checkbox">
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
              {t('appLock.savedRecoveryConfirm')}
            </Text>
          </Pressable>

          {errorText ? (
            <Text variant="caption" color="error" accessibilityLiveRegion="polite">
              {errorText}
            </Text>
          ) : null}

          <Button
            title={t('appLock.enableAppLock')}
            fullWidth
            loading={isBusy}
            disabled={isBusy || !savedChecked}
            onPress={() => {
              void handleCommit();
            }}
            testID="app-lock-commit-setup"
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
          Alert.alert(t('appLock.cancelSetupTitle'), t('appLock.cancelSetupMessage'), [
            { text: t('common.no'), style: 'cancel' },
            {
              text: t('common.yes'),
              style: 'destructive',
              onPress: exit,
            },
          ]);
        }}
        testID="app-lock-setup-cancel"
      />
    </ScrollView>
  );
});
