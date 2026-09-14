import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { useTranslation } from '@/localization';

import {
  getQuickAccessTokens,
  type QuickAccessDensity,
} from './quick-access-tokens';
import { QuickAccessGrid } from './QuickAccessGrid';

export type QuickAccessSectionProps = {
  onOpenSite: (url: string) => void;
  showTitle?: boolean;
  showSubtitle?: boolean;
  title?: string;
  subtitle?: string;
  horizontalPadding?: number;
  paddingTop?: number;
  density?: QuickAccessDensity;
  testID?: string;
};

/**
 * Shared Quick Access block — single config/grid for Browser and Home.
 */
export const QuickAccessSection = memo(function QuickAccessSection({
  onOpenSite,
  showTitle = false,
  showSubtitle = false,
  title,
  subtitle,
  horizontalPadding,
  paddingTop = 0,
  density = 'default',
  testID = 'quick-access-section',
}: QuickAccessSectionProps) {
  const { t } = useTranslation();
  const tokens = getQuickAccessTokens(density);
  const sectionTitle = title ?? t('home.quickAccess');
  const sectionSubtitle = subtitle ?? t('home.quickAccessSubtitle');
  const padding = horizontalPadding ?? tokens.screenPaddingX;

  return (
    <Box
      testID={testID}
      gap={tokens.sectionGap}
      style={{ paddingHorizontal: padding, paddingTop }}
      accessibilityLabel={showTitle ? t('home.quickAccessA11y') : undefined}>
      {showTitle ? (
        <Box gap={4}>
          <Text variant="subtitle" accessibilityRole="header">
            {sectionTitle}
          </Text>
          {showSubtitle ? (
            <Text variant="caption" color="textSecondary">
              {sectionSubtitle}
            </Text>
          ) : null}
        </Box>
      ) : null}
      <QuickAccessGrid
        onOpenSite={onOpenSite}
        horizontalPadding={padding}
        density={density}
        testID={`${testID}-grid`}
      />
    </Box>
  );
});
