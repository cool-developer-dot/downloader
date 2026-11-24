import { memo, useCallback, useState } from 'react';

import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { DsIconButton } from '@/design';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { privateEntryAction } from '@/private-vault/vault-gate';
import { getVaultPort } from '@/private-vault/vault-port';
import { selectAppLockBootstrapped, selectAppLockEnabled, useAppLockStore } from '@/security/app-lock';

/** The Private section's route (src/app/(app)/private.tsx). */
export const PRIVATE_ROUTE = '/private';

/**
 * Player tab header → Private (#459), design 18's lock button. With App Lock on it opens the section (which then asks for the PIN); without
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
      <DsIconButton
        icon="lock"
        accessibilityLabel={t('privateVault.open')}
        accessibilityHint={t('privateVault.openHint')}
        onPress={open}
        testID="library-private"
      />
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
