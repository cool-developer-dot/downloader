import { memo, useCallback, useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import { Box } from '@/components/base/Box';
import { QUICK_SITES, type QuickSite } from '@/browser/config/quick-sites';

import {
  getQuickAccessTokens,
  resolveQuickAccessGap,
  resolveQuickAccessTileWidth,
  type QuickAccessDensity,
} from './quick-access-tokens';
import { QuickSiteCard } from './QuickSiteCard';

export type QuickAccessGridProps = {
  onOpenSite: (url: string) => void;
  /** Defaults to full `QUICK_SITES` registry. */
  sites?: readonly QuickSite[];
  horizontalPadding?: number;
  density?: QuickAccessDensity;
  testID?: string;
};

export const QuickAccessGrid = memo(function QuickAccessGrid({
  onOpenSite,
  sites = QUICK_SITES,
  horizontalPadding,
  density = 'default',
  testID = 'quick-access-grid',
}: QuickAccessGridProps) {
  const { width } = useWindowDimensions();
  const tokens = getQuickAccessTokens(density);
  const padding = horizontalPadding ?? tokens.screenPaddingX;
  const gap = resolveQuickAccessGap(width, density);

  const tileWidth = useMemo(
    () =>
      resolveQuickAccessTileWidth({
        windowWidth: width,
        horizontalPadding: padding,
        density,
      }),
    [density, padding, width],
  );

  const handlePress = useCallback(
    (url: string) => {
      onOpenSite(url);
    },
    [onOpenSite],
  );

  return (
    <Box
      testID={testID}
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap,
      }}>
      {sites.map((site) => (
        <Box key={site.id} style={{ width: tileWidth }}>
          <QuickSiteCard site={site} onPress={handlePress} density={density} />
        </Box>
      ))}
    </Box>
  );
});
