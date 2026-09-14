import { memo, useCallback } from 'react';

import {
  appStoreConfig,
  isPlayStoreListingConfigured,
} from '@/constants/app-identity';
import { push, routePaths } from '@/navigation';
import { useTranslation } from '@/localization';
import { openExternalUrl } from '@/utils/open-external-url';

import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

export type SupportSectionProps = {
  testID?: string;
};

/**
 * Settings → Support: Help & Support, Report a Problem, Rate VidoraX (gated).
 * File historically named AboutSection; Phase 5A keeps this path for Phase 3
 * static verifiers while exporting SupportSection as the product name.
 */
export const SupportSection = memo(function SupportSection({
  testID = 'settings-support',
}: SupportSectionProps) {
  const { t } = useTranslation();
  const rateEnabled = isPlayStoreListingConfigured();

  const openSupport = useCallback(() => {
    push(routePaths.support);
  }, []);

  const openReportProblem = useCallback(() => {
    push(routePaths.reportProblem);
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
      title={t('settings.supportSection')}
      description={t('settings.supportSectionDescription')}
      icon="lifebuoy">
      <SettingsRow
        title={t('settings.support')}
        description={t('settings.supportHint')}
        icon="lifebuoy"
        onPress={openSupport}
        accessibilityHint={t('settings.supportA11y')}
        testID={`${testID}-help`}
      />
      <SettingsRow
        title={t('settings.reportProblem')}
        description={t('settings.reportProblemHint')}
        icon="bug-outline"
        onPress={openReportProblem}
        accessibilityHint={t('settings.reportProblemA11y')}
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



