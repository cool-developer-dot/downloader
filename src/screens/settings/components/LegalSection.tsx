import { memo, useCallback } from 'react';

import { push, routePaths } from '@/navigation';
import { useTranslation } from '@/localization';

import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

export type LegalSectionProps = {
  testID?: string;
};

/**
 * Settings → Legal: Privacy, Terms, About.
 * Licenses stay omitted until a real destination exists (Phase 3A).
 */
export const LegalSection = memo(function LegalSection({
  testID = 'settings-legal',
}: LegalSectionProps) {
  const { t } = useTranslation();

  const openPrivacy = useCallback(() => {
    push(routePaths.privacy);
  }, []);

  const openTerms = useCallback(() => {
    push(routePaths.terms);
  }, []);

  const openAbout = useCallback(() => {
    push(routePaths.about);
  }, []);

  return (
    <SettingsSection
      testID={testID}
      title={t('settings.legalSection')}
      description={t('settings.legalDescription')}
      icon="shield-check-outline">
      <SettingsRow
        title={t('settings.privacyPolicy')}
        description={t('settings.privacyHint')}
        icon="shield-lock-outline"
        onPress={openPrivacy}
        accessibilityHint={t('settings.privacyA11y')}
        testID={`${testID}-privacy`}
      />
      <SettingsRow
        title={t('settings.termsConditions')}
        description={t('settings.termsHint')}
        icon="file-document-outline"
        onPress={openTerms}
        accessibilityHint={t('settings.termsA11y')}
        testID={`${testID}-terms`}
      />
      <SettingsRow
        title={t('settings.aboutApp')}
        description={t('settings.aboutAppHint')}
        icon="information-outline"
        onPress={openAbout}
        showDivider={false}
        accessibilityHint={t('settings.aboutAppA11y')}
        testID={`${testID}-about`}
      />
    </SettingsSection>
  );
});
