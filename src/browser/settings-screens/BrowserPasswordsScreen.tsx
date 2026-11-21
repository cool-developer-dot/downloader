import { memo, useCallback, useState } from 'react';

import { DsHeader, DsRow, DsRowGroup, DsScreen, DsText } from '@/design';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { FormSnippetsSheet } from '@/screens/settings/browser-settings/ShareSettingsSection';

import { notify } from './not-available';

/**
 * Design 7 "Passwords & autofill". VidoraX never stores website passwords (a deliberate choice, see the browser
 * feature list): the phone's own password manager fills and saves sign-ins in VidoraX's pages through Android
 * autofill. The screen says so first; the password rows explain it when tapped; Autofill and Quick form fill open
 * B22's form snippets (#274) for name, address, e-mail and phone fields.
 */
export const BrowserPasswordsScreen = memo(function BrowserPasswordsScreen() {
  const { t } = useTranslation();
  const [snippets, setSnippets] = useState(false);
  const back = useCallback(() => navigation.back(), []);
  const openSettings = useCallback(() => navigation.push(routePaths.browserSettings), []);
  const phoneManager = useCallback(() => notify(t('lightPasswords.phoneManagerHint')), [t]);

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
      <DsText variant="body" testID="browser-passwords-notice">
        {t('lightPasswords.notice')}
      </DsText>
      <DsRowGroup testID="browser-passwords-rows">
        <DsRow
          icon="key"
          title={t('lightPasswords.manager')}
          subtitle={t('lightPasswords.phoneManager')}
          onPress={phoneManager}
          testID="browser-passwords-manager"
        />
        <DsRow
          icon="check"
          title={t('lightPasswords.checkup')}
          subtitle={t('lightPasswords.phoneManager')}
          onPress={phoneManager}
          testID="browser-passwords-checkup"
        />
        <DsRow
          icon="star"
          title={t('lightPasswords.suggest')}
          subtitle={t('lightPasswords.phoneManager')}
          onPress={phoneManager}
          testID="browser-passwords-suggest"
        />
        <DsRow
          icon="terminal"
          title={t('lightPasswords.autofill')}
          subtitle={t('lightPasswords.autofillHint')}
          onPress={() => setSnippets(true)}
          testID="browser-passwords-autofill"
        />
        <DsRow icon="file-text" title={t('lightPasswords.quickFill')} onPress={() => setSnippets(true)} testID="browser-passwords-quick-fill" />
        <DsRow icon="ban" title={t('lightPasswords.neverSave')} onPress={() => notify(t('lightPasswords.neverSaveHint'))} testID="browser-passwords-never-save" />
        <DsRow icon="sliders-vertical" title={t('lightPasswords.importExport')} onPress={phoneManager} testID="browser-passwords-import" />
      </DsRowGroup>
      <FormSnippetsSheet visible={snippets} onClose={() => setSnippets(false)} />
    </DsScreen>
  );
});
