import { memo, useCallback } from 'react';

import { DsButton, DsHeader, DsRow, DsRowGroup, DsScreen } from '@/design';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useAppLockStore } from '@/security/app-lock';
import { protectionRows } from '@/screens/private/ProtectionRows';

import { securityPageModel, setBlockScreenshots, useSecuritySettings } from './security-settings';

/**
 * Design 64 "Security" (Files F10, `/security`): App lock (its existing setup and disable flows), Lock after, Block
 * screenshots for the whole app (#916), File encryption, Hide history and Malware warning (the same always-on
 * protections as the vault page), and Change PIN (the existing screen). App Lock, Auto lock (#917), PIN recovery
 * (#919) and Private's own "Block screenshots in Private" are unchanged and stay in Settings → Privacy too.
 */
export const SecurityScreen = memo(function SecurityScreen() {
  const { t } = useTranslation();
  const isEnabled = useAppLockStore((s) => s.isEnabled);
  const isBusy = useAppLockStore((s) => s.isBusy);
  const settings = useSecuritySettings();
  const page = securityPageModel({ appLockEnabled: isEnabled, settings });

  // The same as Settings → Privacy → App Lock: turning it on runs the setup, off runs the disable flow.
  const onAppLockChange = useCallback(
    (next: boolean) => {
      if (isBusy) return;
      if (next && !isEnabled) {
        navigation.push(routePaths.appLockSetup);
      } else if (!next && isEnabled) {
        navigation.push(routePaths.appLockDisable);
      }
    },
    [isBusy, isEnabled],
  );

  return (
    <DsScreen edges={['top', 'bottom']} testID="security-screen">
      <DsHeader
        title={t('fileManager.securityTitle')}
        subtitle={t('fileManager.securitySub')}
        onBack={() => navigation.back()}
        action={{
          icon: 'settings',
          accessibilityLabel: t('lightBrowserSettings.openAppSettingsA11y'),
          onPress: () => navigation.navigate(routePaths.settings),
          testID: 'security-app-settings',
        }}
        testID="security-header"
      />
      <DsRowGroup testID="security-rows">
        <DsRow
          icon="lock"
          title={t('settings.appLock')}
          subtitle={t('fileManager.appLockSub')}
          toggle={{ value: page.appLock.on, onValueChange: onAppLockChange, accessibilityHint: t('settings.appLockHint') }}
          disabled={isBusy}
          testID="security-app-lock"
        />
        {page.lockAfter ? (
          <DsRow
            icon="clock"
            title={t('fileManager.lockAfter')}
            subtitle={t('fileManager.lockAfterHint')}
            value={t('fileManager.lockAfterImmediately')}
            testID="security-lock-after"
          />
        ) : null}
        <DsRow
          icon="ban"
          title={t('fileManager.blockScreenshots')}
          subtitle={t('fileManager.blockScreenshotsHint')}
          toggle={{ value: page.blockScreenshots.on, onValueChange: setBlockScreenshots }}
          testID="security-block-screenshots"
        />
        {protectionRows(t, 'security-protection')}
      </DsRowGroup>
      {page.pinButton === 'change-pin' ? (
        <DsButton
          label={t('settings.changePin')}
          onPress={() => navigation.push(routePaths.appLockChangePin)}
          fullWidth
          testID="security-change-pin"
        />
      ) : (
        <DsButton
          label={t('privateVault.setUpAppLock')}
          onPress={() => navigation.push(routePaths.appLockSetup)}
          fullWidth
          testID="security-set-up-app-lock"
        />
      )}
    </DsScreen>
  );
});
