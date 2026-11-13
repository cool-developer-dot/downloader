import { memo, useState } from 'react';
import { Modal, Pressable as RNPressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '@/components/base/Box';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { TextField } from '@/components/inputs/TextField';
import { MAX_PROFILE_NAME_LENGTH, type ProfileNameCheck } from '@/browser/profiles/profile-registry';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useTourBlocker } from '@/tour/tour-store';

type Failure = Exclude<ProfileNameCheck, { ok: true }>['reason'];

const ERROR_KEYS = {
  empty: 'browserProfiles.errorEmpty',
  'too-long': 'browserProfiles.errorTooLong',
  taken: 'browserProfiles.errorTaken',
} as const;

/**
 * B20 #206: the name of a new profile, or a new name for one. `onSubmit` returns null when the name was taken, or
 * why it can't be used (shown under the field).
 */
export const ProfileNameSheet = memo(function ProfileNameSheet({
  visible,
  mode,
  initialName,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  mode: 'create' | 'rename';
  initialName: string;
  onSubmit: (name: string) => Failure | 'limit' | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight(visible);
  const { t, rtl } = useTranslation();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [shownFor, setShownFor] = useState<string | null>(null);

  // Each opening starts from its own name.
  const openKey = visible ? `${mode}:${initialName}` : null;
  if (openKey !== shownFor) {
    setShownFor(openKey);
    setName(initialName);
    setError(null);
  }

  useTourBlocker(visible);

  if (!visible) return null;

  const submit = () => {
    const failure = onSubmit(name);
    if (failure === 'limit') {
      onClose();
      return;
    }
    setError(failure ? t(ERROR_KEYS[failure]) : null);
  };

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
          testID="browser-profile-name-sheet"
          style={{
            backgroundColor: theme.colors.card,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            paddingTop: 8,
            paddingHorizontal: 16,
            paddingBottom: keyboardHeight > 0 ? 12 : insets.bottom + 12,
            marginBottom: keyboardHeight,
            maxHeight: keyboardHeight > 0 ? window.height - keyboardHeight - insets.top - 24 : '90%',
            gap: 12,
          }}>
          <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
          <Text variant="title" accessibilityRole="header">
            {mode === 'create' ? t('browserProfiles.newProfileTitle') : t('browserProfiles.renameTitle')}
          </Text>
          <TextField
            label={t('browserProfiles.nameLabel')}
            helperText={t('browserProfiles.nameHint')}
            value={name}
            onChangeText={(next) => {
              setName(next);
              if (error) setError(null);
            }}
            maxLength={MAX_PROFILE_NAME_LENGTH + 10}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
            testID="browser-profile-name-input"
          />
          {error ? (
            <Text variant="caption" color="error" accessibilityLiveRegion="polite" testID="browser-profile-name-error">
              {error}
            </Text>
          ) : null}
          <Box style={{ flexDirection: rtl.rowDirection, justifyContent: 'flex-end', gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
              onPress={onClose}
              style={styles.button}>
              <Text variant="button" color="textSecondary">
                {t('common.cancel')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={mode === 'create' ? t('browserProfiles.create') : t('common.save')}
              onPress={submit}
              testID="browser-profile-name-save"
              style={[styles.button, { backgroundColor: theme.colors.primary, borderRadius: theme.radius.md }]}>
              <Text variant="button" color="textOnPrimary">
                {mode === 'create' ? t('browserProfiles.create') : t('common.save')}
              </Text>
            </Pressable>
          </Box>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 4 },
  button: { minHeight: 48, minWidth: 88, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
});
