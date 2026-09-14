import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { LEGAL_LAYOUT } from './legal-document.constants';

export type LegalListItemProps = {
  text: string;
  testID?: string;
};

/**
 * Non-interactive bullet row for legal list items (not a focusable button).
 */
export const LegalListItem = memo(function LegalListItem({
  text,
  testID,
}: LegalListItemProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <Box
      row
      gap={LEGAL_LAYOUT.listGap}
      style={{ alignItems: 'flex-start' }}
      accessible={false}
      testID={testID}>
      <Text
        variant="body"
        style={{ color: theme.colors.textSecondary, lineHeight: LEGAL_LAYOUT.listLineHeight }}
        importantForAccessibility="no">
        {t('legal.listBullet')}
      </Text>
      <Box flex={1} style={{ minWidth: 0 }}>
        <Text
          variant="body"
          style={{
            color: theme.colors.textSecondary,
            lineHeight: LEGAL_LAYOUT.listLineHeight,
          }}>
          {text}
        </Text>
      </Box>
    </Box>
  );
});
