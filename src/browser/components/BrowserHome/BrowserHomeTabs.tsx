import { memo, useCallback } from 'react';

import { Box } from '@/components/base/Box';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { browserHomeTokens } from './browser-home-tokens';

export type BrowserHomeTabId = 'quickAccess' | 'bookmarks';

export type BrowserHomeTabsProps = {
  activeTab: BrowserHomeTabId;
  onChange: (tab: BrowserHomeTabId) => void;
  testID?: string;
};

export const BrowserHomeTabs = memo(function BrowserHomeTabs({
  activeTab,
  onChange,
  testID = 'browser-home-tabs',
}: BrowserHomeTabsProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  const selectQuickAccess = useCallback(() => {
    onChange('quickAccess');
  }, [onChange]);

  const selectBookmarks = useCallback(() => {
    onChange('bookmarks');
  }, [onChange]);

  return (
    <Box
      testID={testID}
      row
      gap={20}
      style={{
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
        paddingBottom: 4,
      }}>
      <TabButton
        label={t('browser.home.quickAccess')}
        active={activeTab === 'quickAccess'}
        onPress={selectQuickAccess}
        testID={`${testID}-quick-access`}
      />
      <TabButton
        label={t('browser.home.bookmarksTab')}
        active={activeTab === 'bookmarks'}
        onPress={selectBookmarks}
        testID={`${testID}-bookmarks`}
      />
    </Box>
  );
});

type TabButtonProps = {
  label: string;
  active: boolean;
  onPress: () => void;
  testID: string;
};

const TabButton = memo(function TabButton({
  label,
  active,
  onPress,
  testID,
}: TabButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      testID={testID}
      style={{
        minHeight: browserHomeTokens.tabHeight,
        justifyContent: 'center',
        paddingBottom: 8,
        borderBottomWidth: 2,
        borderBottomColor: active ? theme.colors.primary : 'transparent',
      }}>
      <Text
        variant="label"
        color={active ? 'primary' : 'textSecondary'}
        style={{ letterSpacing: 0.6 }}>
        {label}
      </Text>
    </Pressable>
  );
});
