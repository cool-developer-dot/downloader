import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { legalConfig } from '@/legal/config';
import { useTranslation } from '@/localization';

import { LEGAL_LAYOUT } from './legal-document.constants';

export type LegalDocumentHeaderProps = {
  title: string;
  effectiveDate: string;
  updatedDate: string;
  testID?: string;
};

/**
 * Document identity: title, brand, and configured dates.
 * Dates are technical ISO values — not localized formats.
 */
export const LegalDocumentHeader = memo(function LegalDocumentHeader({
  title,
  effectiveDate,
  updatedDate,
  testID = 'legal-document-header',
}: LegalDocumentHeaderProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const showUpdated = updatedDate.trim().length > 0;

  return (
    <Box gap={LEGAL_LAYOUT.headerGap} testID={testID}>
      <Text
        variant="title"
        accessibilityRole="header"
        style={{ color: theme.colors.textPrimary, lineHeight: 32 }}>
        {title}
      </Text>
      <Text
        variant="subtitle"
        style={{
          color: theme.colors.primary,
          letterSpacing: LEGAL_LAYOUT.brandLetterSpacing,
        }}
        accessibilityRole="text"
        accessibilityLabel={legalConfig.productName}>
        {legalConfig.productName}
      </Text>
      <Box gap={LEGAL_LAYOUT.metaGap}>
        <Text
          variant="caption"
          style={{ color: theme.colors.textSecondary, lineHeight: 18 }}>
          {t('legal.effectiveLabel', { date: effectiveDate })}
        </Text>
        {showUpdated ? (
          <Text
            variant="caption"
            style={{ color: theme.colors.textSecondary, lineHeight: 18 }}>
            {t('legal.updatedLabel', { date: updatedDate })}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
});
