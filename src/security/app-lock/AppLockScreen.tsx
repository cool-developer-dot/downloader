import { memo, useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { AppLockForgotFlow } from './AppLockForgotFlow';
import { AppLockPinInput } from './AppLockPinInput';
import { useAppLockStore } from './app-lock.store';

export type AppLockScreenProps = {
  testID?: string;
};

/**
 * Full-screen PIN unlock gate. Forgot PIN stays inside the security gate.
 */
export const AppLockScreen = memo(function AppLockScreen({
  testID = 'app-lock-screen',
}: AppLockScreenProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const unlock = useAppLockStore((s) => s.unlock);
  const isBusy = useAppLockStore((s) => s.isBusy);
  const unlockError = useAppLockStore((s) => s.unlockError);
  const clearUnlockError = useAppLockStore((s) => s.clearUnlockError);
  const openForgotPin = useAppLockStore((s) => s.openForgotPin);
  const lockedSurface = useAppLockStore((s) => s.lockedSurface);
  const formEpoch = useAppLockStore((s) => s.formEpoch);
  const pinRetryAfter = useAppLockStore((s) => s.pinRetryAfter);
  const refreshThrottleSnapshots = useAppLockStore((s) => s.refreshThrottleSnapshots);
  const [pin, setPin] = useState('');
  const [throttleTick, setThrottleTick] = useState(0);

  useEffect(() => {
    setPin('');
    clearUnlockError();
  }, [formEpoch, clearUnlockError]);

  const now = Date.now();
  const throttled = typeof pinRetryAfter === 'number' && pinRetryAfter > now;
  const remainingSec = throttled
    ? Math.max(1, Math.ceil((pinRetryAfter! - now) / 1000))
    : 0;

  useEffect(() => {
    if (!throttled || !pinRetryAfter) {
      return undefined;
    }
    const delay = Math.max(0, pinRetryAfter - Date.now()) + 50;
    const id = setTimeout(() => {
      refreshThrottleSnapshots();
      setThrottleTick((n) => n + 1);
    }, delay);
    return () => clearTimeout(id);
  }, [throttled, pinRetryAfter, refreshThrottleSnapshots, throttleTick]);

  const errorMessage =
    unlockError === 'throttled' || throttled
      ? `${t('appLock.tooManyAttempts')} ${t('appLock.tryAgainInSeconds', { seconds: String(remainingSec || 1) })}`
      : unlockError === 'mismatch'
        ? t('appLock.incorrectPin')
        : unlockError === 'error'
          ? t('appLock.unlockError')
          : null;

  const handleChange = useCallback(
    (next: string) => {
      clearUnlockError();
      setPin(next);
    },
    [clearUnlockError],
  );

  const handleComplete = useCallback(
    async (value: string) => {
      const ok = await unlock(value);
      if (!ok) {
        setPin('');
      }
    },
    [unlock],
  );

  if (lockedSurface === 'forgot') {
    return <AppLockForgotFlow />;
  }

  return (
    <View
      testID={testID}
      accessibilityViewIsModal
      style={{
        flex: 1,
        backgroundColor: theme.colors.background,
        paddingTop: insets.top + 48,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 28,
        justifyContent: 'flex-start',
      }}>
      <Text variant="title" align="center" style={{ marginBottom: 8 }}>
        {t('common.brand')}
      </Text>
      <Text
        variant="subtitle"
        align="center"
        color="textSecondary"
        style={{ marginBottom: 36 }}>
        {t('appLock.enterPin')}
      </Text>

      <AppLockPinInput
        value={pin}
        onChange={handleChange}
        onComplete={(value) => {
          void handleComplete(value);
        }}
        disabled={isBusy || throttled}
        error={errorMessage}
        accessibilityLabel={t('appLock.enterPinA11y')}
        testID={`${testID}-pin`}
      />

      {isBusy ? (
        <Text
          variant="caption"
          align="center"
          color="textSecondary"
          style={{ marginTop: 16 }}>
          {t('common.loading')}
        </Text>
      ) : null}

      <View style={{ flex: 1 }} />

      <Button
        title={t('appLock.unlock')}
        fullWidth
        onPress={() => {
          if (pin.length === 4) {
            void handleComplete(pin);
          }
        }}
        disabled={isBusy || throttled || pin.length !== 4}
        testID={`${testID}-unlock-button`}
      />

      <Pressable
        onPress={openForgotPin}
        accessibilityRole="button"
        accessibilityLabel={t('appLock.forgotPin')}
        style={{ marginTop: 20, paddingVertical: 8 }}
        testID={`${testID}-forgot`}>
        <Text variant="body" align="center" color="primary">
          {t('appLock.forgotPin')}
        </Text>
      </Pressable>
    </View>
  );
});
