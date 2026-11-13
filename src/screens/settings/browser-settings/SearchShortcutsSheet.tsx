import { memo, useMemo, useState } from 'react';
import { Modal, Pressable as RNPressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Divider } from '@/components/common/Divider';
import { TextField } from '@/components/inputs/TextField';
import {
  DEFAULT_SEARCH_SHORTCUTS_JSON,
  MAX_SEARCH_SHORTCUTS,
  parseSearchShortcuts,
  serializeSearchShortcuts,
  validateShortcut,
  type SearchShortcut,
} from '@/browser/search/search-shortcuts';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useSettingsStore } from '@/store/settings';
import { useTourBlocker } from '@/tour/tour-store';

type Editing = { index: number | null; keyword: string; name: string; template: string; engine?: SearchShortcut['engine'] };

const ERROR_KEYS = {
  keyword: 'browserAddress.errorKeyword',
  'keyword-taken': 'browserAddress.errorKeywordTaken',
  name: 'browserAddress.errorName',
  template: 'browserAddress.errorTemplate',
} as const;

/** B4 #33 — add, edit and delete search shortcuts (Browser settings → Search → Search shortcuts). */
export const SearchShortcutsSheet = memo(function SearchShortcutsSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  // The editor's fields and Save stay above the keyboard (a Modal window is not resized for it).
  const keyboardHeight = useKeyboardHeight(visible);
  const { t, rtl } = useTranslation();
  const raw = useSettingsStore((s) => s.searchShortcuts);
  const update = useSettingsStore((s) => s.updateSetting);
  const shortcuts = useMemo(() => parseSearchShortcuts(raw), [raw]);
  // A full list can't take another (saving would drop it): Add is off and says why.
  const atLimit = shortcuts.length >= MAX_SEARCH_SHORTCUTS;
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wasVisible, setWasVisible] = useState(visible);

  // Closed however (back, the backdrop, leaving the screen): it opens on the list next time, not a stale editor.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (!visible) {
      setEditing(null);
      setError(null);
    }
  }

  useTourBlocker(visible);

  if (!visible) return null;

  const save = (list: readonly SearchShortcut[]) => update('searchShortcuts', serializeSearchShortcuts(list));

  const commit = () => {
    if (!editing) return;
    const others = shortcuts.filter((_, i) => i !== editing.index);
    if (editing.engine) {
      // A built-in engine shortcut: only its keyword and name change.
      const check = validateShortcut(
        { keyword: editing.keyword, name: editing.name, template: 'https://x.example/?q=%s' },
        others,
      );
      if (!check.ok) {
        setError(t(ERROR_KEYS[check.reason]));
        return;
      }
      const next = [...shortcuts];
      next[editing.index!] = { keyword: check.shortcut.keyword, name: check.shortcut.name, engine: editing.engine };
      save(next);
    } else {
      const check = validateShortcut(editing, others);
      if (!check.ok) {
        setError(t(ERROR_KEYS[check.reason]));
        return;
      }
      const next = [...shortcuts];
      if (editing.index == null) next.push(check.shortcut);
      else next[editing.index] = check.shortcut;
      save(next);
    }
    setEditing(null);
    setError(null);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={editing ? () => setEditing(null) : onClose} statusBarTranslucent>
      <View style={styles.root}>
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${theme.opacity.overlay})` }]}
        />
        <View
          testID="browser-settings-shortcuts-sheet"
          style={{
            backgroundColor: theme.colors.card,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            paddingTop: 8,
            paddingBottom: keyboardHeight > 0 ? 12 : insets.bottom + 12,
            marginBottom: keyboardHeight,
            maxHeight: keyboardHeight > 0 ? window.height - keyboardHeight - insets.top - 24 : '90%',
          }}>
          <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }} keyboardShouldPersistTaps="handled">
            <Text variant="title" accessibilityRole="header">
              {editing
                ? editing.index == null
                  ? t('browserAddress.addShortcut')
                  : t('browserAddress.editShortcut')
                : t('browserAddress.shortcutsTitle')}
            </Text>

            {editing ? (
              <Box gap={12}>
                <TextField
                  label={t('browserAddress.keyword')}
                  helperText={t('browserAddress.keywordHint')}
                  value={editing.keyword}
                  onChangeText={(keyword) => setEditing({ ...editing, keyword })}
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="browser-shortcut-keyword"
                />
                <TextField
                  label={t('browserAddress.shortcutName')}
                  helperText={t('browserAddress.shortcutNameHint')}
                  value={editing.name}
                  onChangeText={(name) => setEditing({ ...editing, name })}
                  testID="browser-shortcut-name"
                />
                {editing.engine ? (
                  <Text variant="caption" color="textSecondary">
                    {t('browserAddress.shortcutUsesEngine')}
                  </Text>
                ) : (
                  <TextField
                    label={t('browserAddress.shortcutUrl')}
                    helperText={t('browserAddress.shortcutUrlHint')}
                    value={editing.template}
                    onChangeText={(template) => setEditing({ ...editing, template })}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    testID="browser-shortcut-template"
                  />
                )}
                {error ? (
                  <Text variant="caption" color="error" accessibilityLiveRegion="polite" testID="browser-shortcut-error">
                    {error}
                  </Text>
                ) : null}
                <Box style={{ flexDirection: rtl.rowDirection, justifyContent: 'flex-end', gap: 8 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('common.cancel')}
                    onPress={() => {
                      setEditing(null);
                      setError(null);
                    }}
                    style={styles.button}>
                    <Text variant="button" color="textSecondary">
                      {t('common.cancel')}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('common.save')}
                    onPress={commit}
                    testID="browser-shortcut-save"
                    style={[styles.button, { backgroundColor: theme.colors.primary, borderRadius: theme.radius.md }]}>
                    <Text variant="button" color="textOnPrimary">
                      {t('common.save')}
                    </Text>
                  </Pressable>
                </Box>
              </Box>
            ) : (
              <Box>
                {shortcuts.length === 0 ? (
                  <Text variant="body" color="textSecondary">
                    {t('browserAddress.shortcutsEmpty')}
                  </Text>
                ) : null}
                {shortcuts.map((shortcut, index) => (
                  <Box key={shortcut.keyword}>
                    {index > 0 ? <Divider /> : null}
                    <Box style={{ flexDirection: rtl.rowDirection, alignItems: 'center', minHeight: 56, gap: 12 }}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('browserAddress.editShortcutA11y', { name: shortcut.name, keyword: shortcut.keyword })}
                        onPress={() =>
                          setEditing({
                            index,
                            keyword: shortcut.keyword,
                            name: shortcut.name,
                            template: shortcut.template ?? '',
                            engine: shortcut.engine,
                          })
                        }
                        style={{ flex: 1, flexDirection: rtl.rowDirection, alignItems: 'center', gap: 12, minHeight: 52 }}>
                        <Box
                          center
                          style={{
                            minWidth: 40,
                            height: 32,
                            paddingHorizontal: 8,
                            borderRadius: 8,
                            backgroundColor: theme.colors.background,
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                          }}>
                          <Text variant="label">{shortcut.keyword}</Text>
                        </Box>
                        <Box flex={1} style={{ minWidth: 0 }}>
                          <Text variant="body" numberOfLines={1}>
                            {shortcut.name}
                          </Text>
                          <Text variant="caption" color="textSecondary" numberOfLines={1}>
                            {t('browserAddress.shortcutExample', { keyword: shortcut.keyword, query: 'Lahore' })}
                          </Text>
                        </Box>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('browserAddress.deleteShortcutA11y', { name: shortcut.name })}
                        onPress={() => save(shortcuts.filter((_, i) => i !== index))}
                        testID={`browser-shortcut-delete-${shortcut.keyword}`}
                        style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="delete-outline" size={22} color="error" />
                      </Pressable>
                    </Box>
                  </Box>
                ))}
                <Box gap={8} mt={12}>
                  {atLimit ? (
                    <Text variant="caption" color="textSecondary" testID="browser-shortcut-limit">
                      {t('browserAddress.shortcutsLimit', { count: MAX_SEARCH_SHORTCUTS })}
                    </Text>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('browserAddress.addShortcut')}
                    accessibilityState={{ disabled: atLimit }}
                    disabled={atLimit}
                    onPress={() => setEditing({ index: null, keyword: '', name: '', template: 'https://' })}
                    testID="browser-shortcut-add"
                    style={[styles.wide, { backgroundColor: theme.colors.primary, borderRadius: theme.radius.lg }]}>
                    <Icon name="plus" size={20} color="onPrimary" />
                    <Text variant="label" color="textOnPrimary">
                      {t('browserAddress.addShortcut')}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('browserAddress.resetShortcuts')}
                    onPress={() => update('searchShortcuts', DEFAULT_SEARCH_SHORTCUTS_JSON)}
                    testID="browser-shortcut-reset"
                    style={styles.wide}>
                    <Text variant="button" color="textSecondary">
                      {t('browserAddress.resetShortcuts')}
                    </Text>
                  </Pressable>
                </Box>
              </Box>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
  button: { minHeight: 48, minWidth: 88, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  wide: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
