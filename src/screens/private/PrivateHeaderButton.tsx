import { memo, useCallback, useState } from 'react';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { privateEntryAction } from '@/private-vault/vault-gate';
import { getVaultPort } from '@/private-vault/vault-port';
import { selectAppLockBootstrapped, selectAppLockEnabled, useAppLockStore } from '@/security/app-lock';

/** The Private section's route (src/app/(app)/private.tsx). */
export const PRIVATE_ROUTE = '/private';

/**
 * Player tab header → Private (#459). With App Lock on it opens the section (which then asks for the PIN); without
 * a PIN it offers the existing App Lock setup — nothing private exists without one. Hidden on builds without the vault.
 */
export const PrivateHeaderButton = memo(function PrivateHeaderButton() {
  const { t } = useTranslation();
  const bootstrapped = useAppLockStore(selectAppLockBootstrapped);
  const enabled = useAppLockStore(selectAppLockEnabled);
  const [offerSetup, setOfferSetup] = useState(false);

  const open = useCallback(() => {
    switch (privateEntryAction({ bootstrapped, enabled })) {
      case 'open':
        navigation.push(PRIVATE_ROUTE);
        return;
      case 'offer-app-lock-setup':
        setOfferSetup(true);
        return;
      default:
    }
  }, [bootstrapped, enabled]);

  if (!getVaultPort()) {
    return null;
  }

  return (
    <>
      <Pressable
        testID="library-private"
        accessibilityRole="button"
        accessibilityLabel={t('privateVault.open')}
        accessibilityHint={t('privateVault.openHint')}
        onPress={open}
        hitSlop={8}
        style={{ padding: 8 }}>
        <Icon name="lock-outline" size="md" color="headerIcon" />
      </Pressable>
      <ConfirmModal
        visible={offerSetup}
        variant="warning"
        title={t('privateVault.needsAppLockTitle')}
        message={t('privateVault.needsAppLockMessage')}
        confirmLabel={t('privateVault.setUpAppLock')}
        cancelLabel={t('privateVault.notNow')}
        onConfirm={() => {
          setOfferSetup(false);
          navigation.push(routePaths.appLockSetup);
        }}
        onCancel={() => setOfferSetup(false)}
        testID="library-private-app-lock"
      />
    </>
  );
});
