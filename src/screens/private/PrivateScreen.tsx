import { useFocusEffect } from 'expo-router';
import { memo, useCallback, useEffect, useReducer } from 'react';
import { AppState, View } from 'react-native';

import { ds, DsButton, DsCard, DsHeader, DsScreen, DsText } from '@/design';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { isExternalUiOpen } from '@/private-vault/external-ui';
import {
  appLockEvent,
  backgroundPolicy,
  locksOnAppState,
  LOCKED_SESSION,
  reduceVaultSession,
} from '@/private-vault/vault-gate';
import { clearVaultPlayback } from '@/private-vault/vault-port';
import { usePrivateFolderCaptureBlock } from '@/privacy/use-private-folder-capture-block';
import { selectAppLockEnabled, useAppLockStore } from '@/security/app-lock';

import { PrivatePinGate } from './PrivatePinGate';
import { PrivateVaultList } from './PrivateVaultList';

/**
 * Private (#459, #413), designs 28 and 29 (Files F10). Opens locked every time: the App Lock PIN is asked even when
 * VidoraX is unlocked. Leaving the section (going back, or anything opening on top), the app going to the background,
 * App Lock locking the app or being turned off, or the header's lock button — each locks it again, which drops the
 * list and the decrypted thumbnails from memory and deletes the playback file. Without App Lock there is nothing to
 * open: the screen offers to set it up.
 */
export const PrivateScreen = memo(function PrivateScreen() {
  const { t } = useTranslation();
  const enabled = useAppLockStore(selectAppLockEnabled);
  const [session, dispatch] = useReducer(reduceVaultSession, LOCKED_SESSION);
  // P11 #689: with "Block screenshots in Private" on, no screenshot or recording while Private is in front.
  usePrivateFolderCaptureBlock();

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (locksOnAppState(state)) {
        const externalUi = isExternalUiOpen();
        dispatch({ type: 'app-background', externalUi });
        if (backgroundPolicy(externalUi).clearPlayback) {
          clearVaultPlayback();
        }
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(
    () =>
      useAppLockStore.subscribe((state, previous) => {
        // Only a change into locked or disabled counts, and not one caused by a picker Private itself opened.
        const event = appLockEvent(previous, state, isExternalUiOpen());
        if (event) {
          dispatch(event);
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
  // Design 29's lock button: locks at once, exactly as leaving the section does.
  const lockNow = useCallback(() => {
    dispatch({ type: 'left-section' });
    clearVaultPlayback();
  }, []);

  const unlocked = enabled && session.unlocked;

  return (
    <DsScreen
      scroll={false}
      edges={['top', 'bottom']}
      testID="private-screen"
      fixedHeader={
        <View style={{ paddingHorizontal: ds.space.screenX }}>
          <DsHeader
            title={t('filesTab.privateFolder')}
            subtitle={unlocked ? t('fileManager.privateUnlocked') : enabled ? t('fileManager.privateEnterPin') : undefined}
            onBack={goBack}
            action={
              unlocked
                ? {
                    icon: 'lock',
                    accessibilityLabel: t('fileManager.lockNow'),
                    accessibilityHint: t('fileManager.lockNowHint'),
                    onPress: lockNow,
                    testID: 'private-lock-now',
                  }
                : {
                    icon: 'settings',
                    accessibilityLabel: t('fileManager.securityA11y'),
                    onPress: () => navigation.push(routePaths.security),
                    testID: 'private-security',
                  }
            }
            testID="private-header"
          />
        </View>
      }>
      {!enabled ? (
        <View style={{ paddingHorizontal: ds.space.screenX, paddingTop: 12 }}>
          <DsCard testID="private-needs-app-lock">
            <View style={{ gap: 8 }}>
              <DsText variant="bodyStrong">{t('privateVault.needsAppLockTitle')}</DsText>
              <DsText variant="body">{t('privateVault.needsAppLockMessage')}</DsText>
              <DsButton
                label={t('privateVault.setUpAppLock')}
                onPress={() => navigation.push(routePaths.appLockSetup)}
                fullWidth
                style={{ marginTop: 6 }}
                testID="private-set-up-app-lock"
              />
            </View>
          </DsCard>
        </View>
      ) : session.unlocked ? (
        <PrivateVaultList key={session.generation} />
      ) : (
        <PrivatePinGate onVerified={() => dispatch({ type: 'pin-verified' })} />
      )}
    </DsScreen>
  );
});
