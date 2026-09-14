import { memo, type ReactNode } from 'react';

import { Box } from '@/components/base/Box';
import { useTheme } from '@/hooks/use-theme';

import { AddressBar } from './AddressBar';
import { ReloadStopButton } from './ReloadStopButton';

export type BrowserHeaderProps = {
  /** Optional leading slot for future controls (tabs, back-to-app). */
  leadingSlot?: ReactNode;
  /** Optional trailing slot for future controls (menu, share, AI). */
  trailingSlot?: ReactNode;
  testID?: string;
};

/**
 * Browser identity + navigation chrome only.
 * Phase scope: Omnibox, Security Indicator, Reload/Stop.
 * Future actions plug into leadingSlot / trailingSlot without layout rewrites.
 */
export const BrowserHeader = memo(function BrowserHeader({
  leadingSlot,
  trailingSlot,
  testID = 'browser-header',
}: BrowserHeaderProps) {
  const theme = useTheme();

  return (
    <Box
      testID={testID}
      row
      px={16}
      py={12}
      gap={4}
      style={{
        alignItems: 'flex-start',
        backgroundColor: theme.colors.headerBackground,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.headerBorder,
        zIndex: 2,
      }}
      accessibilityRole="header">
      {leadingSlot}
      <AddressBar />
      <ReloadStopButton />
      {trailingSlot}
    </Box>
  );
});
