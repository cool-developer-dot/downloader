import { memo, useMemo } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { legalConfig } from '@/legal/config';
import type { LegalDocument } from '@/legal/types';
import { useTranslation } from '@/localization';

import {
  LEGAL_LAYOUT,
  LegalDocumentHeader,
  LegalFooterActions,
  LegalListItem,
  LegalSectionBlock,
} from './document';

type LegalDocumentViewProps = {
  document: LegalDocument;
  /** Pre-translated accessibility label from the parent screen. */
  accessibilityLabel: string;
  testID: string;
};

/**
 * Shared Privacy/Terms renderer. Content comes from `@/legal` + localization —
 * never embed policy prose in screens.
 */
export const LegalDocumentView = memo(function LegalDocumentView({
  document,
  accessibilityLabel,
  testID,
}: LegalDocumentViewProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  const contactParams = useMemo(
    () => ({
      website: legalConfig.websiteOrigin,
      privacyUrl: legalConfig.publicPrivacyUrl,
      termsUrl: legalConfig.publicTermsUrl,
    }),
    [],
  );

  const title = t(document.titleKey);

  return (
    <Box
      gap={LEGAL_LAYOUT.screenGap}
      pb={LEGAL_LAYOUT.bottomPadding}
      testID={testID}
      accessible={false}
      accessibilityLabel={accessibilityLabel}>
      <LegalDocumentHeader
        title={title}
        effectiveDate={document.effectiveDate}
        updatedDate={document.updatedDate}
      />

      {document.sections.map((section, index) => (
        <LegalSectionBlock
          key={section.id}
          sectionId={section.id}
          heading={t(section.headingKey)}
          showDivider={index > 0}>
          {section.bodyKeys?.map((key) => (
            <Text
              key={key}
              variant="body"
              style={{
                color: theme.colors.textSecondary,
                lineHeight: LEGAL_LAYOUT.paragraphLineHeight,
              }}>
              {t(key, contactParams)}
            </Text>
          ))}
          {section.itemKeys?.map((key) => (
            <LegalListItem key={key} text={t(key, contactParams)} />
          ))}
        </LegalSectionBlock>
      ))}

      <LegalFooterActions documentId={document.id} />
    </Box>
  );
});
