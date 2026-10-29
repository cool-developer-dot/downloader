import { memo } from 'react';
import { Modal, Pressable as RNPressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '@/components/base/Box';
import { Icon, type IconName } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Divider } from '@/components/common/Divider';
import type { BrowserTab } from '@/browser/tabs/types';
import { formatDisplayUrl, isBrowserHomeUrl } from '@/browser/utils';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { TabPreviewImage, useTabSnapshot } from './TabCard';
import { readableTabUrl, tabDisplayTitle } from './tab-display';

export type TabSheetAction = {
  id: string;
  label: string;
  icon: IconName;
  destructive?: boolean;
  onPress: () => void;
};

export type TabActionsSheetProps = {
  tab: BrowserTab | null;
  actions: readonly TabSheetAction[];
  onClose: () => void;
};

/**
 * Long-press on a tab card (B1 #14 + the tab's menu): a larger preview with its title and address, then the tab's
 * actions (pin, duplicate, move, close others, close).
 */
export const TabActionsSheet = memo(function TabActionsSheet({ tab, actions, onClose }: TabActionsSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t, rtl } = useTranslation();
  const window = useWindowDimensions();
  const snapshot = useTabSnapshot(tab?.id ?? '');

  if (!tab) {
    return null;
  }

  const previewWidth = Math.min(window.width - 32, 420);
  const aspect = snapshot?.aspect ?? 0.6;
  const previewHeight = Math.min(Math.round(previewWidth / aspect), Math.round(window.height * 0.34));
  const title = tabDisplayTitle(tab, t);
  const address = isBrowserHomeUrl(tab.url) ? t('browserTabs.startPage') : readableTabUrl(formatDisplayUrl(tab.url) || tab.url);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={onClose}
          style={[styles.backdrop, { backgroundColor: `rgba(0,0,0,${theme.opacity.overlay})` }]}
        />
        <View
          testID="browser-tab-actions-sheet"
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.card,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              paddingBottom: insets.bottom + 12,
              maxHeight: '88%',
            },
          ]}>
          <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16 }}>
            <Box center mb={12}>
              <TabPreviewImage tab={tab} width={previewWidth} height={previewHeight} rounded={theme.radius.md} />
            </Box>
            <Text variant="subtitle" numberOfLines={2}>
              {title}
            </Text>
            <Text variant="bodySmall" color="textSecondary" numberOfLines={2} selectable>
              {address}
            </Text>
            <Box mt={8}>
              {actions.map((action, index) => (
                <Box key={action.id}>
                  {index > 0 ? <Divider /> : null}
                  <Pressable
                    testID={`browser-tab-action-${action.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                    onPress={() => {
                      onClose();
                      action.onPress();
                    }}
                    style={{
                      minHeight: 52,
                      flexDirection: rtl.rowDirection,
                      alignItems: 'center',
                      gap: theme.spacing[12],
                    }}>
                    <Icon name={action.icon} size="md" color={action.destructive ? 'error' : 'default'} />
                    <Text variant="body" color={action.destructive ? 'error' : 'textPrimary'}>
                      {action.label}
                    </Text>
                  </Pressable>
                </Box>
              ))}
            </Box>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill },
  sheet: { paddingTop: 8 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
});
