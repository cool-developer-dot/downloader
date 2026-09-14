import { memo, useCallback } from 'react';

import { Box } from '@/components/base/Box';
import { Icon, type IconName } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import {
  getConfiguredLegalContactEmail,
  isLegalContactConfigured,
  isPublicLegalWebOpenable,
  legalConfig,
} from '@/legal';
import { push, routePaths } from '@/navigation';
import { useTranslation } from '@/localization';
import { openExternalUrl } from '@/utils/open-external-url';

import { LEGAL_LAYOUT } from './legal-document.constants';

export type LegalFooterActionsProps = {
  documentId: 'privacy' | 'terms';
  testID?: string;
};

/**
 * Optional contact / support / public-web actions.
 * Never shows broken mailto or unpublished public-web links.
 */
export const LegalFooterActions = memo(function LegalFooterActions({
  documentId,
  testID = 'legal-footer-actions',
}: LegalFooterActionsProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const contactEmail = isLegalContactConfigured()
    ? getConfiguredLegalContactEmail()
    : null;
  const webOpenable = isPublicLegalWebOpenable();

  const openMail = useCallback(() => {
    if (!contactEmail) {
      return;
    }
    void openExternalUrl(`mailto:${contactEmail}`);
  }, [contactEmail]);

  const openSupport = useCallback(() => {
    push(routePaths.support);
  }, []);

  const openPublicWeb = useCallback(() => {
    if (!webOpenable) {
      return;
    }
    const url =
      documentId === 'privacy'
        ? legalConfig.publicPrivacyUrl
        : legalConfig.publicTermsUrl;
    void openExternalUrl(url);
  }, [documentId, webOpenable]);

  return (
    <Box gap={4} testID={testID}>
      <Box
        style={{
          height: LEGAL_LAYOUT.sectionDividerHeight,
          backgroundColor: theme.colors.divider,
          marginBottom: 8,
        }}
        accessibilityRole="none"
      />

      {contactEmail ? (
        <LegalActionRow
          icon="email-outline"
          title={t('legal.footer.contactTitle')}
          description={t('legal.footer.contactDescription', { email: contactEmail })}
          onPress={openMail}
          accessibilityHint={t('legal.footer.contactA11y')}
          chevron={rtl.chevronForward}
          testID={`${testID}-contact`}
        />
      ) : null}

      {webOpenable ? (
        <LegalActionRow
          icon="open-in-new"
          title={t('legal.footer.webTitle')}
          description={t('legal.footer.webDescription')}
          onPress={openPublicWeb}
          accessibilityHint={t('legal.footer.webA11y')}
          chevron={rtl.chevronForward}
          testID={`${testID}-web`}
        />
      ) : null}

      <LegalActionRow
        icon="lifebuoy"
        title={t('legal.footer.supportTitle')}
        description={t('legal.footer.supportDescription')}
        onPress={openSupport}
        accessibilityHint={t('legal.footer.supportA11y')}
        chevron={rtl.chevronForward}
        testID={`${testID}-support`}
      />
    </Box>
  );
});

type LegalActionRowProps = {
  icon: IconName;
  title: string;
  description: string;
  onPress: () => void;
  accessibilityHint: string;
  chevron: IconName;
  testID: string;
};

const LegalActionRow = memo(function LegalActionRow({
  icon,
  title,
  description,
  onPress,
  accessibilityHint,
  chevron,
  testID,
}: LegalActionRowProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={{ minHeight: LEGAL_LAYOUT.actionMinHeight }}>
      <Box row rtlRow center gap={12} py={10}>
        <Box
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: theme.colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          accessibilityElementsHidden
          importantForAccessibility="no">
          <Icon name={icon} size="md" color="primary" />
        </Box>
        <Box flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text variant="body" style={{ color: theme.colors.textPrimary, lineHeight: 22 }}>
            {title}
          </Text>
          <Text
            variant="caption"
            style={{ color: theme.colors.textSecondary, lineHeight: 16 }}>
            {description}
          </Text>
        </Box>
        <Icon name={chevron} size="sm" color="secondary" />
      </Box>
    </Pressable>
  );
});
