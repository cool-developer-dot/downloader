import { memo, useEffect, useState } from 'react';
import { Modal, Pressable as RNPressable, StyleSheet, View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

export type CloseTabsDialogRequest = {
  kind: 'others' | 'all';
  /** Tabs that close without the pinned ones. */
  unpinnedCount: number;
  /** Pinned tabs that would close only with the box ticked. */
  pinnedCount: number;
};

export type CloseTabsDialogProps = {
  request: CloseTabsDialogRequest | null;
  onCancel: () => void;
  onConfirm: (includePinned: boolean) => void;
};

/** B1 #9 / #10: "Close other tabs?" / "Close all tabs?" with the number of tabs, and "Also close pinned tabs". */
export const CloseTabsDialog = memo(function CloseTabsDialog({ request, onCancel, onConfirm }: CloseTabsDialogProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const [includePinned, setIncludePinned] = useState(false);

  useEffect(() => {
    setIncludePinned(false);
  }, [request]);

  if (!request) {
    return null;
  }

  const count = request.unpinnedCount + (includePinned ? request.pinnedCount : 0);
  const countText =
    count === 0
      ? t('browserTabs.closeNone')
      : count === 1
        ? t('browserTabs.closeCountOne')
        : t('browserTabs.closeCountOther', { count });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.root}>
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={onCancel}
          style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${theme.opacity.overlay})` }]}
        />
        <View
          testID="browser-close-tabs-dialog"
          accessibilityViewIsModal
          style={{
            width: '88%',
            maxWidth: 420,
            backgroundColor: theme.colors.card,
            borderRadius: theme.radius.lg,
            padding: 20,
            gap: 12,
          }}>
          <Text variant="title" accessibilityRole="header">
            {request.kind === 'all' ? t('browserTabs.closeAllTitle') : t('browserTabs.closeOthersTitle')}
          </Text>
          <Text variant="body" color="textSecondary" accessibilityLiveRegion="polite">
            {countText}
            {request.kind === 'all' && count > 0 ? ` ${t('browserTabs.closeAllKeepsStart')}` : ''}
          </Text>
          {request.pinnedCount > 0 ? (
            <Pressable
              testID="browser-close-tabs-include-pinned"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: includePinned }}
              accessibilityLabel={t('browserTabs.alsoClosePinned', { count: request.pinnedCount })}
              onPress={() => setIncludePinned((value) => !value)}
              style={{ minHeight: 48, flexDirection: rtl.rowDirection, alignItems: 'center', gap: 12 }}>
              <Icon
                name={includePinned ? 'checkbox-marked' : 'checkbox-blank-outline'}
                size={24}
                color={includePinned ? 'primary' : 'secondary'}
              />
              <Text variant="body" style={{ flexShrink: 1 }}>
                {t('browserTabs.alsoClosePinned', { count: request.pinnedCount })}
              </Text>
            </Pressable>
          ) : null}
          <Box style={{ flexDirection: rtl.rowDirection, justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <Pressable
              testID="browser-close-tabs-cancel"
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
              onPress={onCancel}
              style={{ minHeight: 48, minWidth: 88, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="button" color="textSecondary">
                {t('common.cancel')}
              </Text>
            </Pressable>
            <Pressable
              testID="browser-close-tabs-confirm"
              accessibilityRole="button"
              accessibilityLabel={`${t('browserTabs.closeConfirm')}. ${countText}`}
              disabled={count === 0}
              onPress={() => onConfirm(includePinned)}
              style={{
                minHeight: 48,
                minWidth: 88,
                paddingHorizontal: 16,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.error,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Text variant="button" style={{ color: theme.colors.white }}>
                {t('browserTabs.closeConfirm')}
              </Text>
            </Pressable>
          </Box>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
