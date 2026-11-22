import { memo, useCallback } from 'react';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { BROWSER_TOUCH_TARGET } from '@/browser/constants';
import { navigation, routePaths } from '@/navigation';
import { primaryAlphas } from '@/theme';

export type BrowserOverflowControlsProps = {
  testID?: string;
};

/**
 * The browser header's ⋮ button. Light theme (design 3): it opens the Page tools screen
 * (`src/browser/page-tools/PageToolsScreen.tsx`), which lists the menu's actions as the design draws them. The
 * anchored popup (`BrowserOverflowMenu`) and the actions hook (`useBrowserMenuActions`) stay for reuse.
 */
export const BrowserOverflowControls = memo(function BrowserOverflowControls({
  testID = 'browser-overflow-controls',
}: BrowserOverflowControlsProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const primary = primaryAlphas(theme.colors.primary);

  const openPageTools = useCallback(() => {
    navigation.push(routePaths.browserPageTools);
  }, []);

  return (
    <Pressable
      testID={`${testID}-trigger`}
      onPress={openPageTools}
      accessibilityRole="button"
      accessibilityLabel={t('browser.openMenuA11y')}
      hitSlop={4}
      style={({ pressed }) => ({
        minWidth: BROWSER_TOUCH_TARGET,
        minHeight: BROWSER_TOUCH_TARGET,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radius.md,
        backgroundColor: pressed ? primary.pressed : 'transparent',
      })}>
      {/* headerIcon (onBrandRed) — 'primary' is brand red and vanishes on the LOGO red header. */}
      <Icon name="dots-vertical" size="md" color="headerIcon" />
    </Pressable>
  );
});
