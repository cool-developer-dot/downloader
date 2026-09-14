import { memo, type ReactNode } from 'react';
import { View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';

import { LEGAL_LAYOUT } from './legal-document.constants';

export type LegalSectionBlockProps = {
  sectionId: string;
  heading: string;
  children: ReactNode;
  showDivider?: boolean;
  testID?: string;
};

/**
 * One legal section with heading + body. Dividers separate sections without cards.
 */
export const LegalSectionBlock = memo(function LegalSectionBlock({
  sectionId,
  heading,
  children,
  showDivider = true,
  testID,
}: LegalSectionBlockProps) {
  const theme = useTheme();

  return (
    <Box gap={LEGAL_LAYOUT.sectionGap} testID={testID ?? `legal-section-${sectionId}`}>
      {showDivider ? (
        <View
          style={{
            height: LEGAL_LAYOUT.sectionDividerHeight,
            backgroundColor: theme.colors.divider,
            marginBottom: 4,
          }}
          accessibilityRole="none"
        />
      ) : null}
      <Text
        variant="subtitle"
        accessibilityRole="header"
        style={{ color: theme.colors.textPrimary, lineHeight: 24 }}>
        {heading}
      </Text>
      <Box gap={LEGAL_LAYOUT.sectionGap}>{children}</Box>
    </Box>
  );
});
