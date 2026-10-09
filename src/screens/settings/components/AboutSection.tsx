import { memo, useCallback } from 'react';

import {
  appStoreConfig,
  isPlayStoreListingConfigured,
} from '@/constants/app-identity';
import { useTranslation } from '@/localization';
import { SUPPORT_EMAIL_ADDRESS } from '@/support/support-email';
import { openSupportEmail } from '@/support/support-email-open';
import { openExternalUrl } from '@/utils/open-external-url';

import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

export type SupportSectionProps = {
  testID?: string;
};

/**
 * Settings → Help & Support: Contact Support and Report an Issue (both a pre-filled email to the support mailbox),
 * Rate VidoraX (gated).
 * File historically named AboutSection; Phase 5A keeps this path for Phase 3
 * static verifiers while exporting SupportSection as the product name.
 */
export const SupportSection = memo(function SupportSection({
  testID = 'settings-support',
}: SupportSectionProps) {
  const { t } = useTranslation();
  const rateEnabled = isPlayStoreListingConfigured();

  const contactSupport = useCallback(() => {
    void openSupportEmail();
  }, []);

  const rateApp = useCallback(() => {
    const url = appStoreConfig.playStoreListingUrl;
    if (!url || !isPlayStoreListingConfigured()) {
      return;
    }
    void openExternalUrl(url);
  }, []);

  return (
    <SettingsSection
      testID={testID}
      title={t('settings.helpSupportSection')}
      description={t('settings.helpSupportDescription')}
      icon="lifebuoy">
      <SettingsRow
        title={t('settings.contactSupport')}
        description={SUPPORT_EMAIL_ADDRESS}
        icon="email-outline"
        onPress={contactSupport}
        accessibilityHint={t('settings.contactSupportA11y')}
        testID={`${testID}-help`}
      />
      <SettingsRow
        title={t('settings.reportIssue')}
        description={t('settings.reportIssueHint')}
        icon="bug-outline"
        onPress={contactSupport}
        accessibilityHint={t('settings.reportIssueA11y')}
        showDivider={rateEnabled}
        testID={`${testID}-report`}
      />
      {rateEnabled ? (
        <SettingsRow
          title={t('settings.rateVidoraX')}
          description={t('settings.rateVidoraXHint')}
          icon="star-outline"
          onPress={rateApp}
          showDivider={false}
          accessibilityHint={t('settings.rateVidoraXA11y')}
          testID={`${testID}-rate`}
        />
      ) : null}
    </SettingsSection>
  );
});

/** Phase 3 verifier / legacy export name. */
export const AboutSection = SupportSection;
export type AboutSectionProps = SupportSectionProps;



