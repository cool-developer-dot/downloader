import { memo, type PropsWithChildren, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { AppLockScreen } from './AppLockScreen';
import { useAppLockStore } from './app-lock.store';
import { useAppLockLifecycle } from './use-app-lock-lifecycle';

/**
 * Root private-app gate: bootstrap → lock screen / integrity error / children.
 * Cold LOCKED: children not mounted. Warm LOCKED: opaque overlay over mounted children.
 */
export const AppLockGate = memo(function AppLockGate({ children }: PropsWithChildren) {
  const theme = useTheme();
  const { t } = useTranslation();
  const bootstrap = useAppLockStore((s) => s.bootstrap);
  const retryBootstrap = useAppLockStore((s) => s.retryBootstrap);
  const isBootstrapped = useAppLockStore((s) => s.isBootstrapped);
  const status = useAppLockStore((s) => s.status);
  const gateMode = useAppLockStore((s) => s.gateMode);
  const privateUiMounted = useAppLockStore((s) => s.privateUiMounted);

  useAppLockLifecycle();

  useEffect(() => {
    if (!isBootstrapped) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const {
          setNotificationAuthProbe,
          flushPendingNotificationTarget,
        } = await import('@/downloads/notifications');
        if (cancelled) {
          return;
        }
        setNotificationAuthProbe(() => {
          const state = useAppLockStore.getState();
          if (!state.isEnabled) {
            return true;
          }
          return state.status === 'UNLOCKED';
        });
        if (useAppLockStore.getState().status === 'UNLOCKED') {
          await flushPendingNotificationTarget();
        }
      } catch {
        // non-fatal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isBootstrapped]);

  useEffect(() => {
    if (status !== 'UNLOCKED') {
      return;
    }
    void import('@/downloads/notifications')
      .then(({ flushPendingNotificationTarget }) =>
        flushPendingNotificationTarget(),
      )
      .catch(() => undefined);
  }, [status]);

  useEffect(() => {
    if (!isBootstrapped) {
      void bootstrap();
    }
  }, [bootstrap, isBootstrapped]);

  const neutralBg = theme.colors.background;

  if (!isBootstrapped || gateMode === 'bootstrapping') {
    return (
      <View
        testID="app-lock-bootstrap-gate"
        style={{
          flex: 1,
          backgroundColor: neutralBg,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (gateMode === 'integrity_error' || gateMode === 'secure_store_error') {
    return (
      <View
        testID="app-lock-integrity-gate"
        style={{
          flex: 1,
          backgroundColor: theme.colors.background,
          paddingHorizontal: 28,
          justifyContent: 'center',
          gap: 16,
        }}>
        <Text variant="title" align="center">
          {t('appLock.integrityTitle')}
        </Text>
        <Text variant="body" align="center" color="textSecondary">
          {gateMode === 'integrity_error'
            ? t('appLock.integrityMessage')
            : t('appLock.secureStoreError')}
        </Text>
        <Button
          title={t('common.retry')}
          fullWidth
          onPress={() => {
            void retryBootstrap();
          }}
          testID="app-lock-integrity-retry"
        />
      </View>
    );
  }

  const showLock = status === 'LOCKED';
  const showChildren = privateUiMounted || status === 'DISABLED' || status === 'UNLOCKED';

  return (
    <View style={{ flex: 1 }} testID="app-lock-gate">
      {showChildren ? (
        <View
          style={{ flex: 1 }}
          pointerEvents={showLock ? 'none' : 'auto'}
          accessibilityElementsHidden={showLock}
          importantForAccessibility={showLock ? 'no-hide-descendants' : 'auto'}>
          {children}
        </View>
      ) : null}

      {showLock ? (
        <View
          style={{
            position: showChildren ? 'absolute' : 'relative',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            flex: showChildren ? undefined : 1,
            zIndex: 1000,
          }}>
          <AppLockScreen />
        </View>
      ) : null}
    </View>
  );
});
