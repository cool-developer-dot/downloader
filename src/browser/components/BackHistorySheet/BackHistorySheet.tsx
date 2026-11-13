import { memo } from 'react';
import { Modal, Pressable as RNPressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Divider } from '@/components/common/Divider';
import type { BackHistoryEntry } from '@/browser/navigation/back-history';
import { readableTabUrl } from '@/browser/components/BrowserTabSwitcher/tab-display';
import { extractPageHostname } from '@/browser/utils';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useTourBlocker } from '@/tour/tour-store';

/** B6 #44: the tab's earlier pages (newest first) after a long press on Back; a row goes back that far. */
export const BackHistorySheet = memo(function BackHistorySheet({
  visible,
  entries,
  onSelect,
  onClose,
}: {
  visible: boolean;
  entries: readonly BackHistoryEntry[];
  onSelect: (entry: BackHistoryEntry) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t, rtl } = useTranslation();

  useTourBlocker(visible);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${theme.opacity.overlay})` }]}
        />
        <View
          testID="browser-back-history"
          style={{
            backgroundColor: theme.colors.card,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            paddingTop: 8,
            paddingBottom: insets.bottom + 12,
            maxHeight: '75%',
          }}>
          <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
          <Box px={16} pb={8}>
            <Text variant="title" accessibilityRole="header">
              {t('browserNav.backHistoryTitle')}
            </Text>
          </Box>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16 }} accessibilityRole="list">
            {entries.map((entry, index) => {
              const host = extractPageHostname(entry.url);
              const title = entry.title || host || entry.url;
              return (
                <Box key={`${entry.steps}`}>
                  {index > 0 ? <Divider /> : null}
                  <Pressable
                    testID={`browser-back-history-${-entry.steps}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${title}. ${host}`}
                    onPress={() => onSelect(entry)}
                    style={{ minHeight: 56, paddingVertical: 8, flexDirection: rtl.rowDirection, alignItems: 'center', gap: 12 }}>
                    <Icon name="history" size={22} color="secondary" />
                    <Box flex={1} style={{ minWidth: 0 }}>
                      <Text variant="body" numberOfLines={1}>
                        {title}
                      </Text>
                      <Text variant="caption" color="textSecondary" numberOfLines={1} style={{ writingDirection: 'ltr' }}>
                        {readableTabUrl(entry.url)}
                      </Text>
                    </Box>
                  </Pressable>
                </Box>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
});
