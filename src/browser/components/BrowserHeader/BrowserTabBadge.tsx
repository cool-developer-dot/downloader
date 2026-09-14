import { memo, useCallback } from 'react';
import { Pressable } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { BROWSER_TOUCH_TARGET } from '@/browser/constants';
import { selectTabCount, useBrowserStore } from '@/browser/stores';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

export type BrowserTabBadgeProps = {
  onPress?: () => void;
  testID?: string;
};

/**
 * Tab count badge — count is always derived from tabs.length.
 */
export const BrowserTabBadge = memo(function BrowserTabBadge({
  onPress,
  testID = 'browser-tab-badge',
}: BrowserTabBadgeProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const count = useBrowserStore(selectTabCount);

  const handlePress = useCallback(() => {
    onPress?.();
  }, [onPress]);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t('browser.tabSwitcherOpenA11y')}
      accessibilityHint={t('browser.home.tabCountA11y', { count })}
      onPress={handlePress}
      hitSlop={6}
      style={{
        width: BROWSER_TOUCH_TARGET,
        height: BROWSER_TOUCH_TARGET,
        marginTop: 2,
        marginRight: 2,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Box
        center
        style={{
          minWidth: 28,
          height: 28,
          paddingHorizontal: 6,
          borderRadius: 8,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}>
        <Text variant="label" color="primary">
          {count}
        </Text>
      </Box>
    </Pressable>
  );
});
