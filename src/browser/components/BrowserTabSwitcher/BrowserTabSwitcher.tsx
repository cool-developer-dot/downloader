import { memo, useCallback } from 'react';
import {
  Modal,
  Pressable as RNPressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { MAX_OPEN_TABS } from '@/browser/tabs/constants';
import {
  selectActiveTabId,
  selectTabs,
  useBrowserStore,
} from '@/browser/stores';
import { extractPageHostname, formatDisplayUrl, isBrowserHomeUrl } from '@/browser/utils';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import type { BrowserTab } from '@/browser/tabs/types';

export type BrowserTabSwitcherProps = {
  visible: boolean;
  onClose: () => void;
  onLimitReached?: () => void;
  testID?: string;
};

function tabSubtitle(tab: BrowserTab): string {
  if (isBrowserHomeUrl(tab.url)) {
    return 'Home';
  }
  return extractPageHostname(tab.url) || formatDisplayUrl(tab.url) || tab.url;
}

function tabTitle(tab: BrowserTab): string {
  if (tab.title?.trim()) {
    return tab.title.trim();
  }
  if (isBrowserHomeUrl(tab.url)) {
    return 'Home';
  }
  return extractPageHostname(tab.url) || 'Tab';
}

/**
 * MVP tab switcher — favicon/title/domain only (no WebView / screenshots).
 */
export const BrowserTabSwitcher = memo(function BrowserTabSwitcher({
  visible,
  onClose,
  onLimitReached,
  testID = 'browser-tab-switcher',
}: BrowserTabSwitcherProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const tabs = useBrowserStore(selectTabs);
  const activeTabId = useBrowserStore(selectActiveTabId);
  const switchTab = useBrowserStore((s) => s.switchTab);
  const closeTab = useBrowserStore((s) => s.closeTab);
  const createTab = useBrowserStore((s) => s.createTab);

  const handleSelect = useCallback(
    (tabId: string) => {
      switchTab(tabId);
      onClose();
    },
    [onClose, switchTab],
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      closeTab(tabId);
    },
    [closeTab],
  );

  const handleNewTab = useCallback(() => {
    const result = createTab();
    if (result.status === 'LIMIT_REACHED') {
      onLimitReached?.();
      return;
    }
    onClose();
  }, [createTab, onClose, onLimitReached]);

  // Unmount when dismissed — Android transparent Modal leftover windows
  // intercept taps across Browser / Downloads / Library.
  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.root} testID={`${testID}-root`}>
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={onClose}
          style={[styles.backdrop, { backgroundColor: `rgba(0,0,0,${theme.opacity.overlay})` }]}
        />
        <View
          testID={testID}
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.card,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              paddingBottom: insets.bottom + 16,
              maxHeight: '78%',
            },
          ]}>
          <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
          <Box row px={20} pb={12} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="title">{t('browser.tabSwitcherTitle')}</Text>
            <Text variant="caption" color="textSecondary">
              {tabs.length}/{MAX_OPEN_TABS}
            </Text>
          </Box>

          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, gap: 8 }}>
            {tabs.map((tab) => {
              const active = tab.id === activeTabId;
              return (
                <Pressable
                  key={tab.id}
                  testID={`browser-tab-card-${tab.id.slice(0, 8)}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${tabTitle(tab)}. ${tabSubtitle(tab)}${
                    active ? `. ${t('browser.tabActiveA11y')}` : ''
                  }`}
                  onPress={() => handleSelect(tab.id)}
                  style={{
                    borderRadius: theme.radius.lg,
                    borderWidth: active ? 2 : 1,
                    borderColor: active ? theme.colors.primary : theme.colors.border,
                    backgroundColor: theme.colors.surface,
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    minHeight: 56,
                  }}>
                  <Box
                    center
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      backgroundColor: theme.colors.background,
                    }}>
                    <Icon
                      name={isBrowserHomeUrl(tab.url) ? 'home' : 'web'}
                      size={20}
                      color={active ? 'primary' : 'secondary'}
                    />
                  </Box>
                  <Box flex={1} style={{ minWidth: 0 }}>
                    <Text variant="body" numberOfLines={1}>
                      {tabTitle(tab)}
                    </Text>
                    <Text variant="caption" color="textSecondary" numberOfLines={1}>
                      {tabSubtitle(tab)}
                    </Text>
                  </Box>
                  <Pressable
                    testID={`browser-tab-close-${tab.id.slice(0, 8)}`}
                    accessibilityRole="button"
                    accessibilityLabel={t('browser.tabSwitcherCloseA11y')}
                    hitSlop={10}
                    onPress={() => handleCloseTab(tab.id)}
                    style={{
                      width: 36,
                      height: 36,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    <Icon name="close" size={20} color="secondary" />
                  </Pressable>
                </Pressable>
              );
            })}
          </ScrollView>

          <Box px={16} pt={8}>
            <Pressable
              testID="browser-tab-switcher-new-tab"
              accessibilityRole="button"
              accessibilityLabel={t('browser.newTabA11y')}
              onPress={handleNewTab}
              style={{
                minHeight: 48,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 8,
              }}>
              <Icon name="tab-plus" size={20} color="onPrimary" />
              <Text variant="label" color="textOnPrimary">
                {t('browser.newTab')}
              </Text>
            </Pressable>
          </Box>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    paddingTop: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 12,
  },
});
