import { memo, type ReactNode } from 'react';

import { Box } from '@/components/base/Box';
import { useTheme } from '@/hooks/use-theme';
import { isIncognitoTabId } from '@/browser/incognito/incognito-state';
import { INCOGNITO_COLORS } from '@/browser/incognito/incognito-theme';
import { IncognitoIcon } from '@/browser/incognito/components/IncognitoIcon';
import { useBrowserStore } from '@/browser/stores';
import { useTranslation } from '@/localization';

import { AddressBar } from './AddressBar';
import { ReloadStopButton } from './ReloadStopButton';

export type BrowserHeaderProps = {
  /** Optional leading slot for future controls (tabs, back-to-app). */
  leadingSlot?: ReactNode;
  /** Optional trailing slot for future controls (menu, share, AI). */
  trailingSlot?: ReactNode;
  /** B4 #28: at the bottom the divider is on top. */
  position?: 'top' | 'bottom';
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
  position = 'top',
  testID = 'browser-header',
}: BrowserHeaderProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  // B11 #108: an incognito tab in front gets the incognito bar, in every theme and language.
  const incognito = useBrowserStore((s) => isIncognitoTabId(s.activeTabId));

  return (
    <Box
      testID={testID}
      row
      px={16}
      py={12}
      gap={4}
      style={{
        alignItems: 'flex-start',
        backgroundColor: incognito ? INCOGNITO_COLORS.surface : theme.colors.headerBackground,
        ...(position === 'bottom'
          ? { borderTopWidth: 1, borderTopColor: incognito ? INCOGNITO_COLORS.border : theme.colors.headerBorder }
          : { borderBottomWidth: 1, borderBottomColor: incognito ? INCOGNITO_COLORS.border : theme.colors.headerBorder }),
        zIndex: 2,
      }}
      accessibilityRole="header">
      {leadingSlot}
      {incognito ? (
        <Box
          testID={`${testID}-incognito`}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('browserIncognito.addressBarA11y')}
          style={{ minHeight: 48, minWidth: 32, alignItems: 'center', justifyContent: 'center' }}>
          <IncognitoIcon size={24} />
        </Box>
      ) : null}
      <AddressBar />
      <ReloadStopButton />
      {trailingSlot}
    </Box>
  );
});
