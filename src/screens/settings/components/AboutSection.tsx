import { memo, useCallback } from 'react';

import { isPlayStoreListingConfigured } from '@/constants/app-identity';
import { useTranslation } from '@/localization';
import { SUPPORT_EMAIL_ADDRESS } from '@/support/support-email';
import { openSupportEmail } from '@/support/support-email-open';
import { showTourAgain } from '@/tour';
import { openPlayStoreListing } from '@/utils/open-play-store-listing';

import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

export type SupportSectionProps = {
  testID?: string;
};

/**
 * Settings → Help & Support: Rate VidoraX first (the VidoraX Play listing — Play Store app, else the web page), then
 * Contact Support and Report an Issue (both a pre-filled email to the support mailbox), and the guided tour again.
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
    if (!isPlayStoreListingConfigured()) {
      return;
    }
    void openPlayStoreListing();
  }, []);

  return (
    <SettingsSection
      testID={testID}
      title={t('settings.helpSupportSection')}
      description={t('settings.helpSupportDescription')}
      icon="lifebuoy">
      {rateEnabled ? (
        <SettingsRow
          title={t('settings.rateVidoraX')}
          description={t('settings.rateVidoraXHint')}
          icon="star-outline"
          onPress={rateApp}
          accessibilityHint={t('settings.rateVidoraXA11y')}
          testID={`${testID}-rate`}
        />
      ) : null}
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
        testID={`${testID}-report`}
      />
      <SettingsRow
        title={t('tour.showAgain')}
        description={t('tour.showAgainHint')}
        icon="compass-outline"
        onPress={showTourAgain}
        showDivider={false}
        accessibilityHint={t('tour.showAgainA11y')}
        testID={`${testID}-tour`}
      />
    </SettingsSection>
  );
});

/** Phase 3 verifier / legacy export name. */
export const AboutSection = SupportSection;
export type AboutSectionProps = SupportSectionProps;



