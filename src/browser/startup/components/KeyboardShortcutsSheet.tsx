import { memo } from 'react';
import { View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Divider } from '@/components/common/Divider';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';

import { KEYBOARD_SHORTCUTS, type ShortcutAction } from '../keyboard-shortcuts';
import { SheetFrame } from './SheetFrame';

export const SHORTCUT_LABELS: Record<ShortcutAction, TranslationKey> = {
  newTab: 'browserStartup.shortcutNewTab',
  closeTab: 'browserStartup.shortcutCloseTab',
  reopenTab: 'browserStartup.shortcutReopenTab',
  nextTab: 'browserStartup.shortcutNextTab',
  previousTab: 'browserStartup.shortcutPreviousTab',
  focusAddressBar: 'browserStartup.shortcutFocusAddressBar',
  reload: 'browserStartup.shortcutReload',
  hardReload: 'browserStartup.shortcutHardReload',
  back: 'browserStartup.shortcutBack',
  forward: 'browserStartup.shortcutForward',
  bookmark: 'browserStartup.shortcutBookmark',
  history: 'browserStartup.shortcutHistory',
  closePanel: 'browserStartup.shortcutClosePanel',
};

/** B21 #246 — the list of keyboard shortcuts (read-only). Keys are shown left-to-right in both languages. */
export const KeyboardShortcutsSheet = memo(function KeyboardShortcutsSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  return (
    <SheetFrame
      visible={visible}
      title={t('browserStartup.shortcuts')}
      onClose={onClose}
      testID="browser-settings-shortcuts-sheet">
      <Text variant="caption" color="textSecondary" style={{ marginBottom: 4 }}>
        {t('browserStartup.shortcutsHint')}
      </Text>
      {KEYBOARD_SHORTCUTS.map((shortcut, index) => {
        const action = t(SHORTCUT_LABELS[shortcut.action]);
        return (
          <Box key={shortcut.action}>
            {index > 0 ? <Divider /> : null}
            <View
              accessible
              accessibilityLabel={t('browserStartup.shortcutA11y', { action, keys: shortcut.keys })}
              style={{ minHeight: 48, flexDirection: rtl.rowDirection, alignItems: 'center', gap: 12, paddingVertical: 6 }}>
              <Text variant="body" style={{ flex: 1 }}>
                {action}
              </Text>
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: theme.radius.sm,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}>
                <Text variant="label" style={{ writingDirection: 'ltr' }}>
                  {shortcut.keys}
                </Text>
              </View>
            </View>
          </Box>
        );
      })}
    </SheetFrame>
  );
});
