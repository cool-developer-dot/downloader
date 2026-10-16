import { useFocusEffect } from 'expo-router';
import { memo, useCallback, useEffect, useReducer } from 'react';
import { AppState } from 'react-native';

import { Box } from '@/components/base/Box';
import { Button } from '@/components/buttons/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { isExternalUiOpen } from '@/private-vault/external-ui';
import { locksOnAppState, LOCKED_SESSION, reduceVaultSession } from '@/private-vault/vault-gate';
import { clearVaultPlayback } from '@/private-vault/vault-port';
import { selectAppLockEnabled, useAppLockStore } from '@/security/app-lock';

import { PrivatePinGate } from './PrivatePinGate';
import { PrivateVaultList } from './PrivateVaultList';

/**
 * Private (#459, #413). Opens locked every time: the App Lock PIN is asked even when VidoraX is unlocked. Leaving the
 * section (going back, or anything opening on top), the app going to the background, App Lock locking the app or
 * being turned off — each locks it again, which drops the list and the decrypted thumbnails from memory and deletes
 * the playback file. Without App Lock there is nothing to open: the screen offers to set it up.
 */
export const PrivateScreen = memo(function PrivateScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const enabled = useAppLockStore(selectAppLockEnabled);
  const [session, dispatch] = useReducer(reduceVaultSession, LOCKED_SESSION);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (locksOnAppState(state)) {
        const externalUi = isExternalUiOpen();
        dispatch({ type: 'app-background', externalUi });
        if (!externalUi) {
          clearVaultPlayback();
        }
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(
    () =>
      useAppLockStore.subscribe((state) => {
        if (!state.isEnabled || state.status === 'LOCKED') {
          dispatch({ type: 'app-lock-changed', enabled: state.isEnabled, appLocked: state.status === 'LOCKED' });
        }
      }),
    [],
  );

  // Losing focus locks: the cleanup runs when another screen opens on top or the user goes back.
  useFocusEffect(
    useCallback(
      () => () => {
        dispatch({ type: 'left-section' });
        clearVaultPlayback();
      },
      [],
    ),
  );

  useEffect(() => () => clearVaultPlayback(), []);

  const goBack = useCallback(() => navigation.back(), []);

  return (
    <SafeAreaScreen
      testID="private-screen"
      padded={false}
      edges={['top', 'left', 'right', 'bottom']}
      style={{ backgroundColor: theme.colors.background }}>
      <ScreenHeader title={t('privateVault.title')} showBack onBackPress={goBack} testID="private-header" />
      {!enabled ? (
        <Box flex={1} px={24} gap={12}>
          <EmptyState
            icon="lock-outline"
            title={t('privateVault.needsAppLockTitle')}
            description={t('privateVault.needsAppLockMessage')}
          />
          <Button
            title={t('privateVault.setUpAppLock')}
            onPress={() => navigation.push(routePaths.appLockSetup)}
            fullWidth
            testID="private-set-up-app-lock"
          />
        </Box>
      ) : session.unlocked ? (
        <PrivateVaultList key={session.generation} />
      ) : (
        <PrivatePinGate onVerified={() => dispatch({ type: 'pin-verified' })} />
      )}
    </SafeAreaScreen>
  );
});
