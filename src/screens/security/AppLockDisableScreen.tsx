import { memo, useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { AppLockPinInput, useAppLockStore } from '@/security/app-lock';

/**
 * Disable App Lock: requires current PIN, then confirmation, then SecureStore wipe.
 * Not reachable from the lock screen.
 */
export const AppLockDisableScreen = memo(function AppLockDisableScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const disable = useAppLockStore((s) => s.disable);
  const isBusy = useAppLockStore((s) => s.isBusy);
  const setupError = useAppLockStore((s) => s.setupError);
  const clearSetupError = useAppLockStore((s) => s.clearSetupError);
  const isEnabled = useAppLockStore((s) => s.isEnabled);

  const [pin, setPin] = useState('');

  useEffect(() => {
    if (!isEnabled) {
      if (router.canGoBack()) {
        router.back();
      }
    }
  }, [isEnabled, router]);

  const finishDisable = useCallback(
    async (value: string) => {
      Alert.alert(t('appLock.disableConfirmTitle'), t('appLock.disableConfirmMessage'), [
        {
          text: t('common.cancel'),
          style: 'cancel',
          onPress: () => setPin(''),
        },
        {
          text: t('appLock.disableConfirmAction'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const ok = await disable(value);
              if (ok) {
                if (router.canGoBack()) {
                  router.back();
                }
                return;
              }
              setPin('');
            })();
          },
        },
      ]);
    },
    [disable, router, t],
  );

  const errorMessage =
    setupError === 'mismatch'
      ? t('appLock.incorrectPin')
      : setupError
        ? t('appLock.disableError')
        : null;

  return (
    <View
      testID="app-lock-disable-screen"
      style={{
        flex: 1,
        backgroundColor: theme.colors.background,
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 24,
      }}>
      <Text variant="title" style={{ marginBottom: 8 }}>
        {t('appLock.disableTitle')}
      </Text>
      <Text variant="body" color="textSecondary" style={{ marginBottom: 28 }}>
        {t('appLock.disableHint')}
      </Text>

      <AppLockPinInput
        value={pin}
        onChange={(next) => {
          clearSetupError();
          setPin(next);
        }}
        onComplete={(value) => {
          void finishDisable(value);
        }}
        disabled={isBusy}
        error={errorMessage}
        accessibilityLabel={t('appLock.disablePinA11y')}
        testID="app-lock-disable-pin"
      />

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
        testID="app-lock-disable-cancel"
      />
    </View>
  );
});
