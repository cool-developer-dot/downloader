import { memo, useCallback, useMemo } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { getAppIdentityMetadata } from '@/constants/app-identity';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { push, routePaths } from '@/navigation';

import { ABOUT_LAYOUT } from './about/about.constants';
import { AboutActionRow } from './about/AboutActionRow';
import { AboutCopyright } from './about/AboutCopyright';
import { AboutIdentityHeader } from './about/AboutIdentityHeader';
import { AboutSection } from './about/AboutSection';
import { useAboutStoreActions } from './about/use-about-store-actions';

export const AboutScreen = memo(function AboutScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const meta = useMemo(() => getAppIdentityMetadata(), []);
  const {
    updateStatus,
    updateCheckEnabled,
    rateEnabled,
    checkForUpdates,
    rateApp,
  } = useAboutStoreActions();

  const openSupport = useCallback(() => {
    push(routePaths.support);
  }, []);

  const openPrivacy = useCallback(() => {
    push(routePaths.privacy);
  }, []);

  const openTerms = useCallback(() => {
    push(routePaths.terms);
  }, []);

  const onCheckUpdates = useCallback(() => {
    void checkForUpdates();
  }, [checkForUpdates]);

  const onRate = useCallback(() => {
    void rateApp();
  }, [rateApp]);

  const updateDescription = !updateCheckEnabled || updateStatus === 'unavailable'
    ? t('about.updateUnavailableDescription')
    : updateStatus === 'checking'
      ? t('about.updateChecking')
      : updateStatus === 'opened_store'
        ? t('about.updateOpenedStore')
        : updateStatus === 'failed'
          ? t('about.updateFailed')
          : t('about.updateIdleDescription');
  const updateLoading = updateStatus === 'checking';

  return (
    <SafeAreaScreen
      testID="about-screen"
      padded
      scrollable
      edges={['bottom', 'left', 'right']}>
      <Box gap={ABOUT_LAYOUT.sectionGap} pb={24}>
        <AboutIdentityHeader />

        <Text
          testID="about-product-description"
          variant="body"
          style={{
            color: theme.colors.textSecondary,
            lineHeight: 22,
          }}
          accessibilityRole="text">
          {t('about.productDescription')}
        </Text>

        <AboutSection
          testID="about-app-information"
          title={t('about.appInformation')}
          icon="cellphone-information">
          <AboutActionRow
            title={t('about.version')}
            icon="tag-outline"
            value={meta.version}
            testID="about-info-version"
            showDivider
          />
          <AboutActionRow
            title={t('about.build')}
            icon="pound"
            value={meta.build}
            testID="about-info-build"
            showDivider
          />
          <AboutActionRow
            title={t('about.platform')}
            icon="cellphone"
            value={meta.platformLabel}
            testID="about-info-platform"
            showDivider={false}
          />
        </AboutSection>

        <AboutSection
          testID="about-app-actions"
          title={t('about.appSection')}
          icon="cellphone">
          <AboutActionRow
            title={t('about.checkForUpdates')}
            description={updateDescription}
            icon="update"
            onPress={updateCheckEnabled ? onCheckUpdates : undefined}
            disabled={!updateCheckEnabled}
            loading={updateLoading}
            accessibilityHint={
              updateCheckEnabled
                ? t('about.checkForUpdatesA11y')
                : t('about.updateUnavailableA11y')
            }
            accessibilityLabel={t('about.checkForUpdates')}
            testID="about-check-updates"
            showDivider
          />
          <AboutActionRow
            title={t('about.rateVidoraX')}
            description={
              rateEnabled
                ? t('about.rateDescription')
                : t('about.rateUnavailableDescription')
            }
            icon="star-outline"
            onPress={rateEnabled ? onRate : undefined}
            disabled={!rateEnabled}
            accessibilityHint={
              rateEnabled ? t('about.rateA11y') : t('about.rateUnavailableA11y')
            }
            accessibilityLabel={t('about.rateVidoraX')}
            testID="about-rate"
            showDivider={false}
          />
        </AboutSection>

        <AboutSection
          testID="about-help-legal"
          title={t('about.helpLegal')}
          icon="shield-check-outline">
          <AboutActionRow
            title={t('about.helpSupport')}
            description={t('about.helpSupportDescription')}
            icon="lifebuoy"
            onPress={openSupport}
            accessibilityHint={t('about.helpSupportA11y')}
            accessibilityLabel={t('about.helpSupport')}
            testID="about-support"
            showDivider
          />
          <AboutActionRow
            title={t('about.privacyPolicy')}
            description={t('about.privacyDescription')}
            icon="shield-lock-outline"
            onPress={openPrivacy}
            accessibilityHint={t('about.privacyA11y')}
            accessibilityLabel={t('about.privacyPolicy')}
            testID="about-privacy"
            showDivider
          />
          <AboutActionRow
            title={t('about.termsConditions')}
            description={t('about.termsDescription')}
            icon="file-document-outline"
            onPress={openTerms}
            accessibilityHint={t('about.termsA11y')}
            accessibilityLabel={t('about.termsConditions')}
            testID="about-terms"
            showDivider={false}
          />
        </AboutSection>

        <AboutCopyright />
      </Box>
    </SafeAreaScreen>
  );
});
