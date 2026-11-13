import { memo, useMemo } from 'react';
import { ScrollView, View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useBrowserStore } from '@/browser/stores';
import { useTheme } from '@/hooks/use-theme';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useTranslation } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import { parseSnippets } from '../form-snippets';
import { insertSnippet, useFocusedFormField } from '../form-snippets.service';

/**
 * B22 #274 — the user's snippets in a bar right above the keyboard while a suitable field of the page in front has
 * focus. A tap inserts one; nothing is ever filled by itself.
 */
export const FormSnippetBar = memo(function FormSnippetBar({ visible }: { visible: boolean }) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const raw = useSettingsStore((s) => s.formSnippets);
  const snippets = useMemo(() => parseSnippets(raw), [raw]);
  const field = useFocusedFormField();
  const activeTabId = useBrowserStore((s) => s.activeTabId);
  const keyboard = useKeyboardHeight();
  if (!visible || snippets.length === 0 || !field || field.tabId !== activeTabId || keyboard <= 0) return null;
  return (
    <View
      testID="browser-form-snippets"
      accessibilityLabel={t('browserShare.snippetBarA11y')}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        // The app window is resized for the keyboard (adjustResize): the bottom of the screen is the keyboard's top.
        bottom: 0,
        zIndex: 50,
        backgroundColor: theme.colors.card,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
      }}>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        contentContainerStyle={{ flexDirection: rtl.rowDirection, gap: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
        {snippets.map((text) => (
          <Pressable
            key={text}
            accessibilityRole="button"
            accessibilityLabel={t('browserShare.snippetInsertA11y', { text })}
            onPress={() => insertSnippet(text)}
            style={{
              minHeight: 48,
              maxWidth: 220,
              justifyContent: 'center',
              paddingHorizontal: 12,
              borderRadius: theme.radius.full,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}>
            <Text variant="bodySmall" numberOfLines={1}>
              {text.replace(/\s+/g, ' ')}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
});
