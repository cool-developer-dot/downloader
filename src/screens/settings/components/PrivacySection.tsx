import { memo, useCallback } from 'react';
import { View } from 'react-native';

import { Switch } from '@/components/inputs/Switch';
import { push, routePaths } from '@/navigation';
import { useTranslation } from '@/localization';
import { useAppLockStore } from '@/security/app-lock';
import { AppLockDataLossWarning } from '@/screens/security/AppLockDataLossWarning';

import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

export type PrivacySectionProps = {
  disabled?: boolean;
  testID?: string;
};

/**
 * Settings → Privacy preferences (App Lock). Distinct from Legal → Privacy Policy.
 */
export const PrivacySection = memo(function PrivacySection({
  disabled = false,
  testID = 'settings-privacy',
}: PrivacySectionProps) {
  const { t } = useTranslation();
  const isEnabled = useAppLockStore((s) => s.isEnabled);
  const isBusy = useAppLockStore((s) => s.isBusy);

  const onValueChange = useCallback(
    (next: boolean) => {
      if (disabled || isBusy) {
        return;
      }
      if (next && !isEnabled) {
        push(routePaths.appLockSetup);
        return;
      }
      if (!next && isEnabled) {
        push(routePaths.appLockDisable);
      }
    },
    [disabled, isBusy, isEnabled],
  );

  return (
    <SettingsSection
      testID={testID}
      title={t('settings.privacySection')}
      description={t('settings.privacySectionDescription')}
      icon="shield-lock-outline">
      <SettingsRow
        title={t('settings.appLock')}
        description={t('settings.appLockHint')}
        icon="shield-lock-outline"
        trailing={
          <Switch
            value={isEnabled}
            onValueChange={onValueChange}
            disabled={disabled || isBusy}
            accessibilityLabel={t('settings.appLock')}
            accessibilityHint={t('settings.appLockHint')}
            testID="settings-app-lock-switch"
          />
        }
        showDivider={isEnabled}
        testID={`${testID}-app-lock`}
      />
      {isEnabled ? (
        <>
          <SettingsRow
            title={t('settings.changePin')}
            description={t('settings.changePinHint')}
            icon="lock-outline"
            onPress={() => push(routePaths.appLockChangePin)}
            accessibilityHint={t('settings.changePinA11y')}
            testID={`${testID}-change-pin`}
          />
          <SettingsRow
            title={t('settings.generateRecoveryCode')}
            description={t('settings.generateRecoveryCodeHint')}
            icon="key-outline"
            onPress={() => push(routePaths.appLockRotateRecovery)}
            showDivider={false}
            accessibilityHint={t('settings.generateRecoveryCodeA11y')}
            testID={`${testID}-rotate-recovery`}
          />
        </>
      ) : null}
      {/* What losing both the PIN and the recovery code means, next to the PIN / recovery code settings. */}
      <View style={{ paddingBottom: 14, paddingTop: isEnabled ? 4 : 0 }}>
        <AppLockDataLossWarning compact testID={`${testID}-data-loss-warning`} />
      </View>
    </SettingsSection>
  );
});
