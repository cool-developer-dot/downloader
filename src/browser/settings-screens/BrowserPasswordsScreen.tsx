import { memo, useCallback, useState } from 'react';

import { DsHeader, DsRow, DsRowGroup, DsScreen } from '@/design';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { FormSnippetsSheet } from '@/screens/settings/browser-settings/ShareSettingsSection';

import { notifyNotAvailableYet } from './not-available';

/**
 * Design 7 "Passwords & autofill". VidoraX has no password manager yet: every row is drawn as designed and says so
 * when tapped, except Quick form fill, which is B22's form snippets (#274).
 */
export const BrowserPasswordsScreen = memo(function BrowserPasswordsScreen() {
  const { t } = useTranslation();
  const [snippets, setSnippets] = useState(false);
  const back = useCallback(() => navigation.back(), []);
  const openSettings = useCallback(() => navigation.push(routePaths.browserSettings), []);

  return (
    <DsScreen testID="browser-passwords-screen">
      <DsHeader
        title={t('lightPasswords.title')}
        subtitle={t('lightPasswords.subtitle')}
        action={{
          icon: 'settings',
          accessibilityLabel: t('lightPrivacy.openSettingsA11y'),
          onPress: openSettings,
          testID: 'browser-passwords-settings',
        }}
      />
      <DsRowGroup testID="browser-passwords-rows">
        <DsRow
          icon="key"
          title={t('lightPasswords.manager')}
          subtitle={t('lightPasswords.saved', { count: 0 })}
          onPress={notifyNotAvailableYet}
          testID="browser-passwords-manager"
        />
        <DsRow
          icon="check"
          title={t('lightPasswords.checkup')}
          subtitle={t('lightPasswords.weak', { count: 0 })}
          onPress={notifyNotAvailableYet}
          testID="browser-passwords-checkup"
        />
        <DsRow
          icon="star"
          title={t('lightPasswords.suggest')}
          toggle={{ value: false, onValueChange: notifyNotAvailableYet }}
          testID="browser-passwords-suggest"
        />
        <DsRow
          icon="terminal"
          title={t('lightPasswords.autofill')}
          subtitle={t('lightPasswords.autofillHint')}
          onPress={notifyNotAvailableYet}
          testID="browser-passwords-autofill"
        />
        <DsRow icon="file-text" title={t('lightPasswords.quickFill')} onPress={() => setSnippets(true)} testID="browser-passwords-quick-fill" />
        <DsRow icon="ban" title={t('lightPasswords.neverSave')} onPress={notifyNotAvailableYet} testID="browser-passwords-never-save" />
        <DsRow icon="sliders-vertical" title={t('lightPasswords.importExport')} onPress={notifyNotAvailableYet} testID="browser-passwords-import" />
      </DsRowGroup>
      <FormSnippetsSheet visible={snippets} onClose={() => setSnippets(false)} />
    </DsScreen>
  );
});
